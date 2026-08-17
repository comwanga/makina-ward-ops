import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuditModule } from "./audit/audit.service";
import { AuthModule } from "./auth/auth.module";
import { AuthorizationModule } from "./authorization/authorization.module";
import { UsersModule } from "./users/users.module";
import { StaffModule } from "./staff/staff.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { AbsenceModule } from "./absence/absence.module";
import { WorkLogModule } from "./work-log/work-log.module";
import { EvidenceModule } from "./evidence/evidence.module";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    AuthorizationModule,
    UsersModule,
    StaffModule,
    AttendanceModule,
    AbsenceModule,
    WorkLogModule,
    EvidenceModule,
  ],
})
export class AppModule {}