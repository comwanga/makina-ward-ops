import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient, prisma } from "@ward-ops/database";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get client(): PrismaClient {
    return prisma;
  }

  async onModuleInit() {
    await prisma.$connect();
  }

  async onModuleDestroy() {
    await prisma.$disconnect();
  }

  async ping(): Promise<boolean> {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  }
}
