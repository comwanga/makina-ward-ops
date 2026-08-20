import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [AuthorizationModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
