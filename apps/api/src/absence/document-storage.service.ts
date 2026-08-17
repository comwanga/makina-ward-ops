import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

export interface StoredDocument {
  objectKey: string;
  size: number;
  sha256: string;
}

export interface DocumentFileInput {
  buffer: Buffer;
  originalName: string;
  contentType: string;
}

/**
 * Storage boundary for absence/supporting documents. The binary lives in
 * private object storage (S3 in Phase 6); PostgreSQL stores only metadata.
 * Access is always through authorized application logic, never a static URL.
 */
export abstract class DocumentStorage {
  abstract save(input: DocumentFileInput): Promise<StoredDocument>;
  abstract read(objectKey: string): Promise<Buffer>;
  abstract delete(objectKey: string): Promise<void>;
}

const OBJECT_KEY_PATTERN = /^[0-9a-f]{48}$/;

/**
 * Local-filesystem implementation used for development and tests. Files are
 * private (0600) and never served statically. The Phase 6 S3 adapter will
 * implement the same interface; production deployments must not rely on the
 * container filesystem for documents.
 */
@Injectable()
export class LocalDocumentStorage extends DocumentStorage {
  private readonly logger = new Logger("DocumentStorage");
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.root = path.resolve(config.documentStoreDir);
  }

  async save(input: DocumentFileInput): Promise<StoredDocument> {
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
    if (!OBJECT_KEY_PATTERN.test(objectKey)) {
      throw new NotFoundException("Document not found");
    }
    return readFile(path.join(this.root, objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    if (!OBJECT_KEY_PATTERN.test(objectKey)) {
      return;
    }
    try {
      await unlink(path.join(this.root, objectKey));
    } catch (error) {
      this.logger.warn(`Compensating delete failed for ${objectKey}: ${String(error)}`);
    }
  }
}