import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { StaffService } from "./staff.service";
import { StaffController } from "./staff.controller";

@Module({
  imports: [AuthorizationModule],
  providers: [StaffService],
  controllers: [StaffController],
  exports: [StaffService],
})
export class StaffModule {}