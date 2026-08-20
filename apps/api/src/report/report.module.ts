import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { StorageModule } from "../storage/storage.module";
import { ReportService } from "./report.service";
import { ReportController } from "./report.controller";

@Module({
  imports: [AuthorizationModule, AttendanceModule, StorageModule],
  providers: [ReportService],
  controllers: [ReportController],
  exports: [ReportService],
})
export class ReportModule {}
