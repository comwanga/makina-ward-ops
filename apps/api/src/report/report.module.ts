import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { ReportService } from "./report.service";
import { ReportController } from "./report.controller";

@Module({
  imports: [AuthorizationModule, AttendanceModule],
  providers: [ReportService],
  controllers: [ReportController],
  exports: [ReportService],
})
export class ReportModule {}