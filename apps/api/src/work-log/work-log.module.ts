import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { WorkLogService } from "./work-log.service";
import { WorkLogController } from "./work-log.controller";

@Module({
  imports: [AuthorizationModule],
  providers: [WorkLogService],
  controllers: [WorkLogController],
  exports: [WorkLogService],
})
export class WorkLogModule {}