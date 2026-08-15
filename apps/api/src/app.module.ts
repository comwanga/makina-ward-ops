import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuditModule } from "./audit/audit.service";
import { AuthModule } from "./auth/auth.module";
import { AuthorizationModule } from "./authorization/authorization.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    AuthorizationModule,
    UsersModule,
  ],
})
export class AppModule {}