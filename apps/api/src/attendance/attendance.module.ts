import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AttendanceService } from "./attendance.service";
import { CheckInThrottleService } from "./check-in-throttle.service";
import { AttendanceController } from "./attendance.controller";

@Module({
  imports: [AuthorizationModule],
  providers: [AttendanceService, CheckInThrottleService],
  controllers: [AttendanceController],
  exports: [AttendanceService, CheckInThrottleService],
})
export class AttendanceModule {}