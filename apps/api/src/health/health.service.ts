import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { ObjectStorage } from "../storage/object-storage.service";

export interface HealthCheckResult {
  database: "up" | "down";
  storage: "up" | "down" | "not_configured";
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async ready(): Promise<HealthCheckResult> {
    let database: "up" | "down" = "down";
    try {
      await this.prisma.ping();
      database = "up";
    } catch {
      database = "down";
    }

    // Readiness reflects the live backing store. When S3 is configured
    // (mandatory in production), a real connectivity probe decides up/down;
    // development/test report "not_configured" so local health checks pass.
    let storage: "up" | "down" | "not_configured" = "not_configured";
    if (this.config.storage.configured) {
      try {
        await this.storage.ping();
        storage = "up";
      } catch {
        storage = "down";
      }
    }

    return { database, storage };
  }
}
