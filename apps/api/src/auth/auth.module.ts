import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoginThrottleService } from "./login-throttle.service";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { SessionAuthGuard } from "./session.guard";
import { CsrfGuard } from "./csrf.guard";
import { CapabilitiesGuard } from "../authorization/capabilities.guard";

@Module({
  providers: [
    LoginThrottleService,
    AuthService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CapabilitiesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  controllers: [AuthController],
  exports: [AuthService, LoginThrottleService],
})
export class AuthModule {}