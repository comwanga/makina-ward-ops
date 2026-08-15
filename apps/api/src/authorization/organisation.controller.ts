import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { PrismaService } from "../prisma/prisma.service";
import { ScopeService } from "./scope.service";

@Controller("organisations")
export class OrganisationController {
  constructor(private readonly scope: ScopeService) {}

  @Get()
  async tree(@CurrentUser() auth: AuthContext | undefined) {
    const counties = await this.scope.organisationTree(auth!);
    return { counties };
  }

  @Get("wards")
  async wards(@CurrentUser() auth: AuthContext | undefined) {
    const wards = await this.scope.accessibleWards(auth!);
    return { wards };
  }
}

@Controller("wards")
export class WardController {
  constructor(
    private readonly scope: ScopeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(":id")
  async ward(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    const accessible = await this.scope.wardAccessible(auth!, id);
    if (!accessible) {
      throw new NotFoundException("Ward not found");
    }
    const ward = await this.prisma.client.ward.findUnique({
      where: { id },
      include: { subcounty: { include: { county: true } } },
    });
    if (!ward) {
      throw new NotFoundException("Ward not found");
    }
    return { ward };
  }
}