import { Module } from "@nestjs/common";
import { ScopeService } from "./scope.service";
import { OrganisationController, WardController } from "./organisation.controller";

@Module({
  providers: [ScopeService],
  controllers: [OrganisationController, WardController],
  exports: [ScopeService],
})
export class AuthorizationModule {}