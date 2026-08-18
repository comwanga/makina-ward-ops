import { Controller, Get, Query } from "@nestjs/common";
import { auditQuerySchema } from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { AuditService } from "./audit.service";

@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequireCapability("AUDIT_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = auditQuerySchema.parse(query);
    return this.audit.list(auth!, input);
  }
}
