import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";

@Module({
  imports: [AuthorizationModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}