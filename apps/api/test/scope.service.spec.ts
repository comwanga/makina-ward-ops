import { describe, expect, it } from "vitest";
import { isScopeWithinAssignment } from "../src/authorization/scope.service";

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