-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SYSTEM_ADMIN', 'WARD_OFFICER', 'SUBCOUNTY_REVIEWER', 'HR_VIEWER', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('COUNTY', 'SUBCOUNTY', 'WARD');

-- CreateEnum
CREATE TYPE "CapabilityCode" AS ENUM ('STAFF_READ', 'STAFF_MANAGE', 'ATTENDANCE_READ', 'ATTENDANCE_MANAGE', 'WORK_READ', 'WORK_CREATE', 'WORK_REVIEW', 'ABSENCE_READ', 'ABSENCE_MANAGE', 'ABSENCE_REVIEW', 'MEDICAL_READ', 'REPORTS_READ', 'REPORTS_FINALIZE', 'AUDIT_READ', 'USERS_MANAGE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'OFF_DUTY', 'LEAVE', 'SICK_OFF', 'OFFICIAL_DUTY');

-- CreateEnum
CREATE TYPE "AbsenceKind" AS ENUM ('ANNUAL_LEAVE', 'MATERNITY_LEAVE', 'PATERNITY_LEAVE', 'COMPASSIONATE_LEAVE', 'SICK_OFF', 'OFFICIAL_DUTY', 'UNPAID_LEAVE');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('PLANNED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkLogStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('COMPLETE', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "EvidenceStage" AS ENUM ('BEFORE', 'DURING', 'AFTER');

-- CreateEnum
CREATE TYPE "DocumentSensitivity" AS ENUM ('MEDICAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('SICK_SHEET', 'MEDICAL_CERTIFICATE', 'LEAVE_FORM', 'LEAVE_APPROVAL', 'RETURN_TO_WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('ON_DUTY', 'ANNUAL_LEAVE');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "County" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "County_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subcounty" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcounty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subcountyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,
    "code" "CapabilityCode" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleCapability" (
    "roleId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,

    CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("roleId","capabilityId")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "countyId" TEXT,
    "subcountyId" TEXT,
    "wardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedScope" "ScopeType",
    "requestedScopeId" TEXT,
    "targetUserId" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "designation" TEXT NOT NULL DEFAULT 'Green Army Staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "wardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "residence" TEXT,
    "rosterStatus" "RosterStatus" NOT NULL DEFAULT 'ON_DUTY',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "activity" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "kind" "AbsenceKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "AbsenceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AbsenceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "activity" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "staffCount" INTEGER NOT NULL DEFAULT 0,
    "challenges" TEXT,
    "status" "WorkLogStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLogDetail" (
    "id" TEXT NOT NULL,
    "workLogId" TEXT NOT NULL,
    "completionStatus" "CompletionStatus" NOT NULL DEFAULT 'COMPLETE',
    "outstandingWork" TEXT,

    CONSTRAINT "WorkLogDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLogOperations" (
    "id" TEXT NOT NULL,
    "workLogId" TEXT NOT NULL,
    "areasRoads" TEXT NOT NULL,
    "numberOfTrips" INTEGER NOT NULL DEFAULT 0,
    "wasteTransferInvolved" BOOLEAN NOT NULL DEFAULT false,
    "truckId" TEXT,
    "backhoeId" TEXT,
    "cleanupDone" BOOLEAN NOT NULL DEFAULT false,
    "cleanupStakeholders" TEXT,
    "climateTeamCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkLogOperations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "workLogId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "stage" "EvidenceStage" NOT NULL,
    "caption" TEXT,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "absenceRequestId" TEXT,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sensitivity" "DocumentSensitivity" NOT NULL DEFAULT 'MEDICAL',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentClassification" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,

    CONSTRAINT "DocumentClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "finalizedBy" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportEvidence" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "evidenceId" TEXT,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "caption" TEXT,
    "stage" "EvidenceStage" NOT NULL,

    CONSTRAINT "ReportEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "absenceRequestId" TEXT NOT NULL,
    "reminderDays" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "scopeType" "ScopeType",
    "scopeId" TEXT,
    "details" TEXT,
    "sourceIp" TEXT,
    "requestId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "County_code_key" ON "County"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subcounty_code_key" ON "Subcounty"("code");

-- CreateIndex
CREATE INDEX "Subcounty_countyId_idx" ON "Subcounty"("countyId");

-- CreateIndex
CREATE UNIQUE INDEX "Ward_code_key" ON "Ward"("code");

-- CreateIndex
CREATE INDEX "Ward_subcountyId_idx" ON "Ward"("subcountyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Capability_code_key" ON "Capability"("code");

-- CreateIndex
CREATE INDEX "Assignment_userId_idx" ON "Assignment"("userId");

-- CreateIndex
CREATE INDEX "Assignment_wardId_idx" ON "Assignment"("wardId");

-- CreateIndex
CREATE INDEX "Assignment_subcountyId_idx" ON "Assignment"("subcountyId");

-- CreateIndex
CREATE INDEX "Assignment_countyId_idx" ON "Assignment"("countyId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_userId_roleId_scopeType_countyId_subcountyId_war_key" ON "Assignment"("userId", "roleId", "scopeType", "countyId", "subcountyId", "wardId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AccessRequest_email_idx" ON "AccessRequest"("email");

-- CreateIndex
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");

-- CreateIndex
CREATE INDEX "Employee_wardId_idx" ON "Employee"("wardId");

-- CreateIndex
CREATE INDEX "Employee_employeeNumber_idx" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_wardId_employeeNumber_key" ON "Employee"("wardId", "employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_employeeId_key" ON "EmployeeProfile"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_employeeId_idx" ON "EmployeeAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_wardId_idx" ON "EmployeeAssignment"("wardId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_token_key" ON "AttendanceSession"("token");

-- CreateIndex
CREATE INDEX "AttendanceSession_wardId_workDate_idx" ON "AttendanceSession"("wardId", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceSession_workDate_idx" ON "AttendanceSession"("workDate");

-- CreateIndex
CREATE INDEX "Attendance_wardId_workDate_idx" ON "Attendance"("wardId", "workDate");

-- CreateIndex
CREATE INDEX "Attendance_workDate_idx" ON "Attendance"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_workDate_key" ON "Attendance"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "AbsenceRequest_employeeId_status_startDate_endDate_idx" ON "AbsenceRequest"("employeeId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "AbsenceRequest_wardId_idx" ON "AbsenceRequest"("wardId");

-- CreateIndex
CREATE INDEX "AbsenceRequest_status_idx" ON "AbsenceRequest"("status");

-- CreateIndex
CREATE INDEX "WorkLog_wardId_workDate_idx" ON "WorkLog"("wardId", "workDate");

-- CreateIndex
CREATE INDEX "WorkLog_workDate_idx" ON "WorkLog"("workDate");

-- CreateIndex
CREATE INDEX "WorkLog_status_idx" ON "WorkLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLogDetail_workLogId_key" ON "WorkLogDetail"("workLogId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLogOperations_workLogId_key" ON "WorkLogOperations"("workLogId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_objectKey_key" ON "Evidence"("objectKey");

-- CreateIndex
CREATE INDEX "Evidence_workLogId_idx" ON "Evidence"("workLogId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_objectKey_key" ON "Document"("objectKey");

-- CreateIndex
CREATE INDEX "Document_absenceRequestId_idx" ON "Document"("absenceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentClassification_documentId_key" ON "DocumentClassification"("documentId");

-- CreateIndex
CREATE INDEX "Report_scopeType_scopeId_periodStart_periodEnd_idx" ON "Report"("scopeType", "scopeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Report_kind_idx" ON "Report"("kind");

-- CreateIndex
CREATE INDEX "ReportEvidence_reportId_idx" ON "ReportEvidence"("reportId");

-- CreateIndex
CREATE INDEX "ReminderDelivery_status_idx" ON "ReminderDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_absenceRequestId_reminderDays_key" ON "ReminderDelivery"("absenceRequestId", "reminderDays");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- AddForeignKey
ALTER TABLE "Subcounty" ADD CONSTRAINT "Subcounty_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_subcountyId_fkey" FOREIGN KEY ("subcountyId") REFERENCES "Subcounty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleCapability" ADD CONSTRAINT "RoleCapability_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleCapability" ADD CONSTRAINT "RoleCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRequest" ADD CONSTRAINT "AbsenceRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogDetail" ADD CONSTRAINT "WorkLogDetail_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLogOperations" ADD CONSTRAINT "WorkLogOperations_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "WorkLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_absenceRequestId_fkey" FOREIGN KEY ("absenceRequestId") REFERENCES "AbsenceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentClassification" ADD CONSTRAINT "DocumentClassification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEvidence" ADD CONSTRAINT "ReportEvidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_absenceRequestId_fkey" FOREIGN KEY ("absenceRequestId") REFERENCES "AbsenceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
