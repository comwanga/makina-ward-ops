-- Enforce the documented invariant that exactly one scope column matches
-- scopeType on user assignments. Application code already honours this; the
-- constraint protects the invariant at the database level.
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scope_consistency_check" CHECK (
  ("scopeType" = 'COUNTY' AND "countyId" IS NOT NULL AND "subcountyId" IS NULL AND "wardId" IS NULL)
  OR ("scopeType" = 'SUBCOUNTY' AND "subcountyId" IS NOT NULL AND "countyId" IS NULL AND "wardId" IS NULL)
  OR ("scopeType" = 'WARD' AND "wardId" IS NOT NULL AND "countyId" IS NULL AND "subcountyId" IS NULL)
);
