import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

export interface StoredObject {
  objectKey: string;
  size: number;
  sha256: string;
}

export interface StorageFileInput {
  buffer: Buffer;
  originalName: string;
  contentType: string;
}

/**
 * Storage boundary for binary evidence and supporting documents. The binary
 * lives in private object storage (S3 in production, local disk in dev/tests);
 * PostgreSQL stores only metadata. Access is always through authorized
 * application logic, never a static URL.
 */
@Injectable()
export abstract class ObjectStorage {
  abstract save(input: StorageFileInput): Promise<StoredObject>;
  abstract read(objectKey: string): Promise<Buffer>;
  abstract delete(objectKey: string): Promise<void>;
  /**
   * Lists all stored object keys. Used by migration reconciliation tooling to
   * detect objects that have no database metadata.
   */
  abstract list(): Promise<string[]>;
  /**
   * Connectivity probe used by the readiness endpoint. Resolves when the
   * backing store is reachable and usable; rejects otherwise.
   */
  abstract ping(): Promise<void>;
}

const LOCAL_KEY_PATTERN = /^[0-9a-f]{48}$/;

/**
 * Local-filesystem implementation used for development and tests. Files are
 * private (0600) and never served statically. Production deployments must not
 * rely on the container filesystem for evidence.
 */
@Injectable()
export class LocalObjectStorage extends ObjectStorage {
  private readonly logger = new Logger("ObjectStorage");
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.root = path.resolve(config.documentStoreDir);
  }

  async save(input: StorageFileInput): Promise<StoredObject> {
    await mkdir(this.root, { recursive: true });
    const objectKey = randomBytes(24).toString("hex");
    await writeFile(path.join(this.root, objectKey), input.buffer, { mode: 0o600 });
    return {
      objectKey,
      size: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
    };
  }

  async read(objectKey: string): Promise<Buffer> {
    if (!LOCAL_KEY_PATTERN.test(objectKey)) {
      throw new NotFoundException("Object not found");
    }
    try {
      return await readFile(path.join(this.root, objectKey));
    } catch {
      // A missing object must surface as 404 (not 500): database metadata can
      // outlive the stored object, and that broken-evidence state is detectable
      // on read (§24).
      throw new NotFoundException("Object not found");
    }
  }

  async delete(objectKey: string): Promise<void> {
    if (!LOCAL_KEY_PATTERN.test(objectKey)) {
      return;
    }
    try {
      await unlink(path.join(this.root, objectKey));
    } catch (error) {
      this.logger.warn(`Compensating delete failed for ${objectKey}: ${String(error)}`);
    }
  }

  async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.root);
      return entries.filter((name) => LOCAL_KEY_PATTERN.test(name)).sort();
    } catch {
      return [];
    }
  }

  async ping(): Promise<void> {
    // Resolves only if the directory exists and is readable; rejects on
    // permission or filesystem errors so readiness can report storage down.
    await mkdir(this.root, { recursive: true });
    await readdir(this.root);
  }
}

const S3_KEY_PATTERN = /^[0-9a-f]{48}$/;

/**
 * Private S3-compatible object storage (ADR-0004). Objects are stored with
 * opaque random keys and no public URL; every read flows through authorized
 * application logic. Credentials are read from the environment and are never
 * exposed to clients.
 */
@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  private readonly logger = new Logger("S3ObjectStorage");
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    const storage = config.storage;
    if (!storage.bucket) {
      throw new Error("S3 storage requires S3_BUCKET");
    }
    this.bucket = storage.bucket;
    this.prefix = "ward-ops";
    this.client = new S3Client({
      region: storage.region,
      endpoint: storage.endpoint || undefined,
      forcePathStyle: storage.forcePathStyle,
      credentials:
        storage.accessKeyId && storage.secretAccessKey
          ? {
              accessKeyId: storage.accessKeyId,
              secretAccessKey: storage.secretAccessKey,
            }
          : undefined,
    });
  }

  private key(objectKey: string): string {
    return `${this.prefix}/${objectKey}`;
  }

  async save(input: StorageFileInput): Promise<StoredObject> {
    const objectKey = randomBytes(24).toString("hex");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(objectKey),
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );
    return {
      objectKey,
      size: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
    };
  }

  async read(objectKey: string): Promise<Buffer> {
    if (!S3_KEY_PATTERN.test(objectKey)) {
      throw new NotFoundException("Object not found");
    }
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(objectKey) }),
      );
      if (!response.Body) {
        throw new NotFoundException("Object not found");
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // NoSuchKey and transport failures both mean the object cannot be served
      // as evidence; treat as not found (§24).
      throw new NotFoundException("Object not found");
    }
  }

  async delete(objectKey: string): Promise<void> {
    if (!S3_KEY_PATTERN.test(objectKey)) {
      return;
    }
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(objectKey) }),
      );
    } catch (error) {
      this.logger.warn(`Compensating delete failed for ${objectKey}: ${String(error)}`);
    }
  }

  async list(): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${this.prefix}/`,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key && S3_KEY_PATTERN.test(item.Key.slice(this.prefix.length + 1))) {
          keys.push(item.Key.slice(this.prefix.length + 1));
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return keys.sort();
  }

  async ping(): Promise<void> {
    // Probe with ListObjectsV2(MaxKeys:1) rather than HeadBucket: it uses the
    // same s3:ListBucket permission the reconciliation list() method already
    // requires, and has no head-object quirks. It never reads or writes data.
    await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${this.prefix}/`, MaxKeys: 1 }),
    );
  }
}
