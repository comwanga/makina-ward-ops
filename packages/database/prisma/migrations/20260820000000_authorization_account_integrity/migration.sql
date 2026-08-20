-- Remove exact duplicate assignments that PostgreSQL's NULL semantics allowed
-- through the original compound unique constraint.
DELETE FROM "Assignment" duplicate
USING "Assignment" canonical
WHERE duplicate."userId" = canonical."userId"
  AND duplicate."roleId" = canonical."roleId"
  AND duplicate."scopeType" = canonical."scopeType"
  AND duplicate."id" > canonical."id"
  AND duplicate."countyId" IS NOT DISTINCT FROM canonical."countyId"
  AND duplicate."subcountyId" IS NOT DISTINCT FROM canonical."subcountyId"
  AND duplicate."wardId" IS NOT DISTINCT FROM canonical."wardId";

-- Each geographic assignment must point at a real organisation node.
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_countyId_fkey"
  FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_subcountyId_fkey"
  FOREIGN KEY ("subcountyId") REFERENCES "Subcounty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_wardId_fkey"
  FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial indexes correctly enforce uniqueness for nullable polymorphic scope columns.
CREATE UNIQUE INDEX "Assignment_user_role_county_key"
  ON "Assignment"("userId", "roleId", "countyId") WHERE "scopeType" = 'COUNTY';
CREATE UNIQUE INDEX "Assignment_user_role_subcounty_key"
  ON "Assignment"("userId", "roleId", "subcountyId") WHERE "scopeType" = 'SUBCOUNTY';
CREATE UNIQUE INDEX "Assignment_user_role_ward_key"
  ON "Assignment"("userId", "roleId", "wardId") WHERE "scopeType" = 'WARD';

-- Historical migrated requests may be unscoped, but partial scope pairs are invalid.
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requested_scope_pair_check" CHECK (
  ("requestedScope" IS NULL AND "requestedScopeId" IS NULL)
  OR ("requestedScope" IS NOT NULL AND "requestedScopeId" IS NOT NULL)
);
