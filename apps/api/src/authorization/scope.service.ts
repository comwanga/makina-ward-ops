import { Injectable } from "@nestjs/common";
import type { CapabilityCode, ScopeType } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuthContext } from "../auth/auth-context";

export type ScopeTarget = { scopeType: ScopeType; scopeId: string };

export interface AssignmentScope {
  scopeType: ScopeType;
  countyId: string | null;
  subcountyId: string | null;
  wardId: string | null;
}

export interface CapabilityAssignment extends AssignmentScope {
  capabilities: CapabilityCode[];
}

export interface WardLineage {
  subcountyId: string;
  countyId: string;
}

export interface SubcountyLineage {
  countyId: string;
}

/**
 * Pure scope-membership rule. A resource (target) is allowed for an
 * assignment when its scope equals or is contained within the assignment.
 */
export function isScopeWithinAssignment(
  assignment: AssignmentScope,
  target: ScopeTarget,
  lineage: { subcountyId?: string; countyId?: string },
): boolean {
  switch (target.scopeType) {
    case "WARD":
      if (assignment.scopeType === "WARD") {
        return assignment.wardId === target.scopeId;
      }
      if (assignment.scopeType === "SUBCOUNTY") {
        return assignment.subcountyId === lineage.subcountyId;
      }
      if (assignment.scopeType === "COUNTY") {
        return assignment.countyId === lineage.countyId;
      }
      return false;
    case "SUBCOUNTY":
      if (assignment.scopeType === "SUBCOUNTY") {
        return assignment.subcountyId === target.scopeId;
      }
      if (assignment.scopeType === "COUNTY") {
        return assignment.countyId === lineage.countyId;
      }
      return false;
    case "COUNTY":
      return assignment.scopeType === "COUNTY" && assignment.countyId === target.scopeId;
    default:
      return false;
  }
}

export function isScopeAuthorized(
  assignments: CapabilityAssignment[],
  target: ScopeTarget,
  lineage: { subcountyId?: string; countyId?: string },
  requiredCapabilities: CapabilityCode[] = [],
): boolean {
  return assignments.some(
    (assignment) =>
      requiredCapabilities.every((capability) =>
        assignment.capabilities.includes(capability),
      ) && isScopeWithinAssignment(assignment, target, lineage),
  );
}

export interface WardSummary {
  id: string;
  code: string;
  name: string;
  subcountyId: string;
}

export interface AccessibleScopeIds {
  wardIds: Set<string>;
  subcountyIds: Set<string>;
  countyIds: Set<string>;
}

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async countyAccessible(auth: AuthContext, countyId: string): Promise<boolean> {
    return this.authorizeTarget(
      auth,
      { scopeType: "COUNTY", scopeId: countyId },
      {},
    );
  }

  async scopeAccessible(
    auth: AuthContext,
    scopeType: ScopeType,
    scopeId: string,
  ): Promise<boolean> {
    if (scopeType === "WARD") return this.wardAccessible(auth, scopeId);
    if (scopeType === "SUBCOUNTY") return this.subcountyAccessible(auth, scopeId);
    return this.countyAccessible(auth, scopeId);
  }

  async subcountyAccessible(auth: AuthContext, subcountyId: string): Promise<boolean> {
    const subcounty = await this.prisma.client.subcounty.findUnique({
      where: { id: subcountyId },
      select: { countyId: true },
    });
    if (!subcounty) return false;
    const lineage: SubcountyLineage = { countyId: subcounty.countyId };
    return this.authorizeTarget(
      auth,
      { scopeType: "SUBCOUNTY", scopeId: subcountyId },
      lineage,
    );
  }

  async wardAccessible(auth: AuthContext, wardId: string): Promise<boolean> {
    const ward = await this.prisma.client.ward.findUnique({
      where: { id: wardId },
      include: { subcounty: { include: { county: true } } },
    });
    if (!ward) return false;
    const lineage: WardLineage = {
      subcountyId: ward.subcountyId,
      countyId: ward.subcounty.countyId,
    };
    return this.authorizeTarget(
      auth,
      { scopeType: "WARD", scopeId: wardId },
      lineage,
    );
  }

  async accessibleWards(
    auth: AuthContext,
    requiredCapabilities: CapabilityCode[] = auth.requiredCapabilities ?? [],
  ): Promise<WardSummary[]> {
    const wards = await this.prisma.client.ward.findMany({
      include: { subcounty: { include: { county: true } } },
      orderBy: { name: "asc" },
    });
    const accessible = wards
      .map((ward) => ({
        ward,
        assignments: auth.assignments.filter((assignment) =>
          requiredCapabilities.every((capability) => assignment.capabilities.includes(capability)) &&
          isScopeWithinAssignment(
            assignment,
            { scopeType: "WARD", scopeId: ward.id },
            { subcountyId: ward.subcountyId, countyId: ward.subcounty.countyId },
          ),
        ),
      }))
      .filter(({ assignments }) => assignments.length > 0);
    return accessible.map(({ ward }) => ({
      id: ward.id,
      code: ward.code,
      name: ward.name,
      subcountyId: ward.subcountyId,
    }));
  }

  /**
   * Precomputes the set of ward/subcounty/county ids the user can access, so
   * callers (e.g. report listing) can filter in memory without one query per
   * resource. A WARD assignment grants ward access only (not the containing
   * subcounty/county); a SUBCOUNTY assignment grants that subcounty and its
   * wards; a COUNTY assignment grants the county, its subcounties and wards.
   */
  async accessibleScopeIds(auth: AuthContext): Promise<AccessibleScopeIds> {
    const countyIds = new Set<string>();
    const subcountyIds = new Set<string>();
    for (const assignment of this.capabilityAssignments(auth)) {
      if (assignment.scopeType === "COUNTY" && assignment.countyId) {
        countyIds.add(assignment.countyId);
      } else if (assignment.scopeType === "SUBCOUNTY" && assignment.subcountyId) {
        subcountyIds.add(assignment.subcountyId);
      }
    }
    if (countyIds.size > 0) {
      const subcounties = await this.prisma.client.subcounty.findMany({
        where: { countyId: { in: [...countyIds] } },
        select: { id: true },
      });
      for (const subcounty of subcounties) subcountyIds.add(subcounty.id);
    }
    const wards = await this.accessibleWards(auth);
    const wardIds = new Set(wards.map((ward) => ward.id));
    return { wardIds, subcountyIds, countyIds };
  }

  async organisationTree(auth: AuthContext): Promise<Array<{
    id: string;
    code: string;
    name: string;
    subcounties: Array<{
      id: string;
      code: string;
      name: string;
      wards: WardSummary[];
    }>;
  }>> {
    const counties = await this.prisma.client.county.findMany({
      include: { subcounties: { include: { wards: true } } },
      orderBy: { name: "asc" },
    });
    return counties
      .map((county) => ({
        id: county.id,
        code: county.code,
        name: county.name,
        subcounties: county.subcounties
          .map((subcounty) => ({
            id: subcounty.id,
            code: subcounty.code,
            name: subcounty.name,
            wards: subcounty.wards
              .filter((ward) =>
                isScopeAuthorized(
                  auth.assignments,
                  { scopeType: "WARD", scopeId: ward.id },
                  { subcountyId: subcounty.id, countyId: county.id },
                  auth.requiredCapabilities,
                ),
              )
              .map((ward) => ({
                id: ward.id,
                code: ward.code,
                name: ward.name,
                subcountyId: ward.subcountyId,
              })),
          }))
          .filter((subcounty) => subcounty.wards.length > 0 ||
            isScopeAuthorized(
              auth.assignments,
              { scopeType: "SUBCOUNTY", scopeId: subcounty.id },
              { countyId: county.id },
              auth.requiredCapabilities,
            )),
      }))
      .filter((county) => county.subcounties.length > 0 ||
        isScopeAuthorized(
          auth.assignments,
          { scopeType: "COUNTY", scopeId: county.id },
          {},
          auth.requiredCapabilities,
        ));
  }

  private capabilityAssignments(auth: AuthContext): AuthContext["assignments"] {
    const required = auth.requiredCapabilities ?? [];
    return auth.assignments.filter((assignment) =>
      required.every((capability) => assignment.capabilities.includes(capability)),
    );
  }

  private matchingAssignments(
    auth: AuthContext,
    target: ScopeTarget,
    lineage: { subcountyId?: string; countyId?: string },
  ): AuthContext["assignments"] {
    return this.capabilityAssignments(auth).filter((assignment) =>
      isScopeWithinAssignment(assignment, target, lineage),
    );
  }

  private authorizeTarget(
    auth: AuthContext,
    target: ScopeTarget,
    lineage: { subcountyId?: string; countyId?: string },
  ): boolean {
    const assignments = this.matchingAssignments(auth, target, lineage);
    auth.capabilities = Array.from(
      new Set(assignments.flatMap((assignment) => assignment.capabilities)),
    );
    return assignments.length > 0;
  }
}
