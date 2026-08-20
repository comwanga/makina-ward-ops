ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'CHIEF_SUBCOUNTY_OFFICER';
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'ASSISTANT_DIRECTOR';
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'DEPUTY_DIRECTOR';
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'DIRECTOR';

ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'STAFF_IMPORT';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'REPORTS_GENERATE';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'REPORTS_EXPORT';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'USERS_READ';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'USERS_DISABLE';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'PERMISSIONS_MANAGE';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'SCOPE_MANAGE';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'RECORD_ARCHIVE';
ALTER TYPE "CapabilityCode" ADD VALUE IF NOT EXISTS 'EVIDENCE_REMOVE';

-- Repair historical organisation references before adding constraints.
DELETE FROM "EmployeeAssignment" assignment
WHERE NOT EXISTS (SELECT 1 FROM "Ward" ward WHERE ward."id" = assignment."wardId");

UPDATE "Attendance" attendance
SET "wardId" = session."wardId"
FROM "AttendanceSession" session
WHERE attendance."sessionId" = session."id"
  AND attendance."wardId" IS DISTINCT FROM session."wardId";

UPDATE "AbsenceRequest" absence
SET "wardId" = employee."wardId"
FROM "Employee" employee
WHERE absence."employeeId" = employee."id"
  AND NOT EXISTS (SELECT 1 FROM "Ward" ward WHERE ward."id" = absence."wardId");

UPDATE "AccessRequest" SET "targetUserId" = NULL
WHERE "targetUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "AccessRequest"."targetUserId");
UPDATE "AccessRequest" SET "reviewedBy" = NULL
WHERE "reviewedBy" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "AccessRequest"."reviewedBy");
UPDATE "ReportEvidence" SET "evidenceId" = NULL
WHERE "evidenceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Evidence" WHERE "Evidence"."id" = "ReportEvidence"."evidenceId");

ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_wardId_fkey"
  FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_wardId_fkey"
  FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AbsenceRequest" ADD CONSTRAINT "AbsenceRequest_wardId_fkey"
  FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_reviewedBy_fkey"
  FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReportEvidence" ADD CONSTRAINT "ReportEvidence_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "EmployeeAssignment_active_employee_ward_key"
  ON "EmployeeAssignment"("employeeId", "wardId") WHERE "endedAt" IS NULL;

CREATE OR REPLACE FUNCTION validate_scope_reference(scope_type "ScopeType", scope_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN CASE scope_type
    WHEN 'COUNTY' THEN EXISTS (SELECT 1 FROM "County" WHERE "id" = scope_id)
    WHEN 'SUBCOUNTY' THEN EXISTS (SELECT 1 FROM "Subcounty" WHERE "id" = scope_id)
    WHEN 'WARD' THEN EXISTS (SELECT 1 FROM "Ward" WHERE "id" = scope_id)
  END;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_access_request_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestedScope" IS NOT NULL
     AND NOT validate_scope_reference(NEW."requestedScope", NEW."requestedScopeId") THEN
    RAISE EXCEPTION 'Access request scope does not exist';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_report_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT validate_scope_reference(NEW."scopeType", NEW."scopeId") THEN
    RAISE EXCEPTION 'Report scope does not exist';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AccessRequest_scope_reference"
  BEFORE INSERT OR UPDATE OF "requestedScope", "requestedScopeId" ON "AccessRequest"
  FOR EACH ROW EXECUTE FUNCTION enforce_access_request_scope();
CREATE TRIGGER "Report_scope_reference"
  BEFORE INSERT OR UPDATE OF "scopeType", "scopeId" ON "Report"
  FOR EACH ROW EXECUTE FUNCTION enforce_report_scope();
