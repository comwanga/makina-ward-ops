import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { LocalObjectStorage, ObjectStorage, S3ObjectStorage } from "./object-storage.service";

/**
 * Provides the ObjectStorage boundary. Production deploys with S3 configured
 * use S3ObjectStorage; development and tests use the local filesystem. Both
 * implement the same private, metadata-only contract (ADR-0004).
 */
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.env === "production" && !config.storage.configured) {
          throw new Error(
            "Object storage is required in production (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY); refusing to fall back to container-local storage",
          );
        }
        return config.storage.configured ? new S3ObjectStorage(config) : new LocalObjectStorage(config);
      },
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
