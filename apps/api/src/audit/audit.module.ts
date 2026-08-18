import { Global, Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AuditService } from "./audit.service";
import { AuditController } from "./audit.controller";

@Global()
@Module({
  imports: [AuthorizationModule],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
