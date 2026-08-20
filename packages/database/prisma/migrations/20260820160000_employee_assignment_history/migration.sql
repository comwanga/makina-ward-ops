CREATE TYPE "EmployeeAssignmentKind" AS ENUM ('PRIMARY', 'TEMPORARY');

ALTER TABLE "Employee" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
UPDATE "Employee" SET "deactivatedAt" = "updatedAt" WHERE "active" = false;

ALTER TABLE "EmployeeAssignment"
  ADD COLUMN "kind" "EmployeeAssignmentKind" NOT NULL DEFAULT 'TEMPORARY';

-- Establish an effective-dated primary assignment for every current employee.
INSERT INTO "EmployeeAssignment" ("id", "employeeId", "wardId", "kind", "assignedAt")
SELECT 'primary_' || employee."id", employee."id", employee."wardId", 'PRIMARY', employee."createdAt"
FROM "Employee" employee
WHERE NOT EXISTS (
  SELECT 1 FROM "EmployeeAssignment" assignment
  WHERE assignment."employeeId" = employee."id" AND assignment."kind" = 'PRIMARY'
);

CREATE UNIQUE INDEX "EmployeeAssignment_active_primary_key"
  ON "EmployeeAssignment"("employeeId")
  WHERE "kind" = 'PRIMARY' AND "endedAt" IS NULL;
