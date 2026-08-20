import { Controller, Get } from "@nestjs/common";
import { AuthContext, CurrentUser } from "../auth/auth-context";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() auth: AuthContext | undefined) {
    return this.dashboard.get(auth!);
  }
}
