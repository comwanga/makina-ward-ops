import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

export interface HealthCheckResult {
  database: "up" | "down";
  storage: "up" | "down" | "not_configured";
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
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

    // Object storage integration lands in Phase 6. Until then readiness only
    // reports its configuration state.
    const storage: "up" | "down" | "not_configured" = this.config.storage.configured
      ? "down"
      : "not_configured";

    return { database, storage };
  }
}
