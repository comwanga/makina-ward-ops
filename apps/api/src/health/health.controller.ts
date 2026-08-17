import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { Public } from "../common/public.decorator";
import { HealthService } from "./health.service";

// Liveness/readiness probes are reachable without an authenticated session so
// orchestrators and load balancers can query them.
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  live() {
    return { status: "ok" as const };
  }

  @Get("ready")
  async ready() {
    const checks = await this.health.ready();
    const ready = checks.database === "up" && checks.storage !== "down";
    if (!ready) {
      throw new HttpException(
        { status: "not_ready", checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: "ready" as const, checks };
  }
}
