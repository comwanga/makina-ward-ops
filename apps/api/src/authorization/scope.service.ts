import { Injectable } from "@nestjs/common";
import type { ScopeType } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuthContext } from "../auth/auth-context";

export type ScopeTarget = { scopeType: ScopeType; scopeId: string };

export interface AssignmentScope {
  scopeType: ScopeType;
  countyId: string | null;
  subcountyId: string | null;
  wardId: string | null;
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
    return auth.assignments.some(
      (assignment) =>
        assignment.scopeType === "COUNTY" && assignment.countyId === countyId,
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
    return auth.assignments.some((assignment) =>
      isScopeWithinAssignment(
        assignment,
        { scopeType: "SUBCOUNTY", scopeId: subcountyId },
        lineage,
      ),
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
    return auth.assignments.some((assignment) =>
      isScopeWithinAssignment(
        assignment,
        { scopeType: "WARD", scopeId: wardId },
        lineage,
      ),
    );
  }

  async accessibleWards(auth: AuthContext): Promise<WardSummary[]> {
    const wards = await this.prisma.client.ward.findMany({
      include: { subcounty: { include: { county: true } } },
      orderBy: { name: "asc" },
    });
    return wards
      .filter((ward) =>
        auth.assignments.some((assignment) =>
          isScopeWithinAssignment(
            assignment,
            { scopeType: "WARD", scopeId: ward.id },
            { subcountyId: ward.subcountyId, countyId: ward.subcounty.countyId },
          ),
        ),
      )
      .map((ward) => ({
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
    for (const assignment of auth.assignments) {
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
    const allSubcounties = counties.flatMap((county) => county.subcounties);
    const allWards = allSubcounties.flatMap((subcounty) => subcounty.wards);
    const subcountyToCounty = new Map(
      allSubcounties.map((subcounty) => [subcounty.id, subcounty.countyId]),
    );

    const countyIds = new Set<string>();
    const subcountyIds = new Set<string>();
    const wardIds = new Set<string>();

    for (const assignment of auth.assignments) {
      if (assignment.scopeType === "COUNTY" && assignment.countyId) {
        countyIds.add(assignment.countyId);
      } else if (assignment.scopeType === "SUBCOUNTY" && assignment.subcountyId) {
        subcountyIds.add(assignment.subcountyId);
      } else if (assignment.scopeType === "WARD" && assignment.wardId) {
        wardIds.add(assignment.wardId);
      }
    }
    for (const subcountyId of subcountyIds) {
      const countyId = subcountyToCounty.get(subcountyId);
      if (countyId) countyIds.add(countyId);
    }
    for (const wardId of wardIds) {
      const subcountyId = allWards.find((ward) => ward.id === wardId)?.subcountyId;
      if (subcountyId) {
        subcountyIds.add(subcountyId);
        const countyId = subcountyToCounty.get(subcountyId);
        if (countyId) countyIds.add(countyId);
      }
    }
    // Ward-scoped assignments that inherit their subcounty/county are resolved
    // above; assignments themselves never reference ward ancestry, so also
    // include wards reachable through subcounty/county assignments.
    for (const ward of allWards) {
      if (subcountyIds.has(ward.subcountyId)) wardIds.add(ward.id);
      const countyId = subcountyToCounty.get(ward.subcountyId);
      if (countyId && countyIds.has(countyId)) wardIds.add(ward.id);
    }

    const accessibleWardIds = wardIds;
    return counties
      .filter((county) => countyIds.has(county.id))
      .map((county) => ({
        id: county.id,
        code: county.code,
        name: county.name,
        subcounties: county.subcounties
          .filter((subcounty) => subcountyIds.has(subcounty.id))
          .map((subcounty) => ({
            id: subcounty.id,
            code: subcounty.code,
            name: subcounty.name,
            wards: subcounty.wards
              .filter((ward) => accessibleWardIds.has(ward.id))
              .map((ward) => ({
                id: ward.id,
                code: ward.code,
                name: ward.name,
                subcountyId: ward.subcountyId,
              })),
          })),
      }));
  }
}