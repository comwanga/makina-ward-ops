import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { StorageModule } from "../storage/storage.module";
import { EvidenceService } from "./evidence.service";
import { EvidenceController } from "./evidence.controller";

@Module({
  imports: [AuthorizationModule, StorageModule],
  providers: [EvidenceService],
  controllers: [EvidenceController],
  exports: [EvidenceService],
})
export class EvidenceModule {}