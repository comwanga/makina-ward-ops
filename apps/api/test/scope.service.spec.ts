import { describe, expect, it } from "vitest";
import {
  isScopeAuthorized,
  isScopeWithinAssignment,
  ScopeService,
} from "../src/authorization/scope.service";
import type { AuthContext } from "../src/auth/auth-context";

const wardAssignment = {
  scopeType: "WARD" as const,
  countyId: null,
  subcountyId: null,
  wardId: "ward-makina",
};
const subcountyAssignment = {
  scopeType: "SUBCOUNTY" as const,
  countyId: null,
  subcountyId: "sub-kibra",
  wardId: null,
};
const countyAssignment = {
  scopeType: "COUNTY" as const,
  countyId: "county-ncc",
  subcountyId: null,
  wardId: null,
};

describe("isScopeWithinAssignment", () => {
  it("allows a ward-scoped user access to exactly their ward", () => {
    expect(
      isScopeWithinAssignment(
        wardAssignment,
        { scopeType: "WARD", scopeId: "ward-makina" },
        { subcountyId: "sub-kibra", countyId: "county-ncc" },
      ),
    ).toBe(true);
    expect(
      isScopeWithinAssignment(
        wardAssignment,
        { scopeType: "WARD", scopeId: "ward-woodley" },
        { subcountyId: "sub-kibra", countyId: "county-ncc" },
      ),
    ).toBe(false);
  });

  it("allows a subcounty reviewer every ward under the subcounty only", () => {
    expect(
      isScopeWithinAssignment(
        subcountyAssignment,
        { scopeType: "WARD", scopeId: "ward-makina" },
        { subcountyId: "sub-kibra", countyId: "county-ncc" },
      ),
    ).toBe(true);
    expect(
      isScopeWithinAssignment(
        subcountyAssignment,
        { scopeType: "WARD", scopeId: "ward-outside" },
        { subcountyId: "sub-langata", countyId: "county-ncc" },
      ),
    ).toBe(false);
  });

  it("allows a county admin every ward under the county only", () => {
    expect(
      isScopeWithinAssignment(
        countyAssignment,
        { scopeType: "WARD", scopeId: "ward-makina" },
        { subcountyId: "sub-kibra", countyId: "county-ncc" },
      ),
    ).toBe(true);
    expect(
      isScopeWithinAssignment(
        countyAssignment,
        { scopeType: "WARD", scopeId: "ward-mombasa" },
        { subcountyId: "sub-x", countyId: "county-mombasa" },
      ),
    ).toBe(false);
  });

  it("resolves subcounty and county targets", () => {
    expect(
      isScopeWithinAssignment(
        subcountyAssignment,
        { scopeType: "SUBCOUNTY", scopeId: "sub-kibra" },
        { countyId: "county-ncc" },
      ),
    ).toBe(true);
    expect(
      isScopeWithinAssignment(
        countyAssignment,
        { scopeType: "SUBCOUNTY", scopeId: "sub-kibra" },
        { countyId: "county-ncc" },
      ),
    ).toBe(true);
    expect(
      isScopeWithinAssignment(
        countyAssignment,
        { scopeType: "SUBCOUNTY", scopeId: "sub-other" },
        { countyId: "county-mombasa" },
      ),
    ).toBe(false);
    expect(
      isScopeWithinAssignment(
        countyAssignment,
        { scopeType: "COUNTY", scopeId: "county-ncc" },
        {},
      ),
    ).toBe(true);
    expect(
      isScopeWithinAssignment(
        subcountyAssignment,
        { scopeType: "COUNTY", scopeId: "county-ncc" },
        {},
      ),
    ).toBe(false);
  });
});

describe("isScopeAuthorized", () => {
  it("requires capability and scope to come from the same assignment", () => {
    const assignments = [
      { ...wardAssignment, capabilities: ["STAFF_MANAGE"] as const },
      {
        scopeType: "WARD" as const,
        countyId: null,
        subcountyId: null,
        wardId: "ward-woodley",
        capabilities: ["STAFF_READ"] as const,
      },
    ];

    expect(
      isScopeAuthorized(
        assignments.map((assignment) => ({
          ...assignment,
          capabilities: [...assignment.capabilities],
        })),
        { scopeType: "WARD", scopeId: "ward-woodley" },
        { subcountyId: "sub-langata", countyId: "county-ncc" },
        ["STAFF_MANAGE"],
      ),
    ).toBe(false);
    expect(
      isScopeAuthorized(
        assignments.map((assignment) => ({
          ...assignment,
          capabilities: [...assignment.capabilities],
        })),
        { scopeType: "WARD", scopeId: "ward-makina" },
        { subcountyId: "sub-kibra", countyId: "county-ncc" },
        ["STAFF_MANAGE"],
      ),
    ).toBe(true);
  });

  it("narrows dynamic capabilities to assignments matching the checked resource", async () => {
    const scope = new ScopeService({
      client: {
        ward: {
          findUnique: async () => ({
            id: "ward-woodley",
            subcountyId: "sub-langata",
            subcounty: { countyId: "county-ncc" },
          }),
        },
      },
    } as never);
    const auth = {
      capabilities: ["STAFF_MANAGE", "STAFF_READ"],
      assignments: [
        {
          id: "manage-makina",
          role: "WARD_OFFICER",
          roleName: "ward officer",
          ...wardAssignment,
          capabilities: ["STAFF_MANAGE"],
        },
        {
          id: "read-woodley",
          role: "READ_ONLY",
          roleName: "read only",
          scopeType: "WARD",
          countyId: null,
          subcountyId: null,
          wardId: "ward-woodley",
          capabilities: ["STAFF_READ"],
        },
      ],
    } as AuthContext;

    expect(await scope.wardAccessible(auth, "ward-woodley")).toBe(true);
    expect(auth.capabilities).toEqual(["STAFF_READ"]);
  });

  it("does not expand a ward assignment to sibling wards in the organisation tree", async () => {
    const scope = new ScopeService({
      client: {
        county: {
          findMany: async () => [{
            id: "county-ncc",
            code: "NCC",
            name: "Nairobi",
            subcounties: [{
              id: "sub-kibra",
              code: "KIBRA",
              name: "Kibra",
              countyId: "county-ncc",
              wards: [
                { id: "ward-makina", code: "MAKINA", name: "Makina", subcountyId: "sub-kibra" },
                { id: "ward-sibling", code: "SIBLING", name: "Sibling", subcountyId: "sub-kibra" },
              ],
            }],
          }],
        },
      },
    } as never);
    const auth = {
      assignments: [{
        id: "makina-only",
        role: "WARD_OFFICER",
        roleName: "ward officer",
        ...wardAssignment,
        capabilities: ["STAFF_READ"],
      }],
      capabilities: ["STAFF_READ"],
    } as AuthContext;

    const tree = await scope.organisationTree(auth);
    expect(tree[0].subcounties[0].wards.map((ward) => ward.code)).toEqual(["MAKINA"]);
  });
});
