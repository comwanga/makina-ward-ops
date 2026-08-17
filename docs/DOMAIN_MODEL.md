# Domain Model — Proposed Prisma Schema

Status: **Phase 0 proposal** (awaiting review).

Single PostgreSQL database, one relational model. Makina is data. Every
operational record carries its organisational scope.

## 1. Enums

```prisma
enum RoleCode {
  SYSTEM_ADMIN
  WARD_OFFICER
  SUBCOUNTY_REVIEWER
  HR_VIEWER
  READ_ONLY
}

enum ScopeType {
  COUNTY
  SUBCOUNTY
  WARD
}

enum CapabilityCode {
  STAFF_READ
  STAFF_MANAGE
  ATTENDANCE_READ
  ATTENDANCE_MANAGE
  WORK_READ
  WORK_CREATE
  WORK_REVIEW
  ABSENCE_READ
  ABSENCE_MANAGE
  ABSENCE_REVIEW
  MEDICAL_READ
  REPORTS_READ
  REPORTS_FINALIZE
  AUDIT_READ
  USERS_MANAGE
}

enum AttendanceStatus {
  PRESENT
  LATE
  ABSENT
  OFF_DUTY
  LEAVE
  SICK_OFF
  OFFICIAL_DUTY
}

enum AbsenceKind {
  ANNUAL_LEAVE
  MATERNITY_LEAVE
  PATERNITY_LEAVE
  COMPASSIONATE_LEAVE
  SICK_OFF
  OFFICIAL_DUTY
  UNPAID_LEAVE
}

enum AbsenceStatus {
  PLANNED
  SUBMITTED
  APPROVED
  REJECTED
  CANCELLED
}

enum WorkLogStatus {
  SUBMITTED
  APPROVED
  REJECTED
}

enum CompletionStatus {
  COMPLETE
  INCOMPLETE
}

enum EvidenceStage {
  BEFORE
  DURING
  AFTER
}

enum DocumentSensitivity {
  MEDICAL
  GENERAL
}

enum DocumentCategory {
  SICK_SHEET
  MEDICAL_CERTIFICATE
  LEAVE_FORM
  LEAVE_APPROVAL
  RETURN_TO_WORK
  OTHER
}

enum ReportKind {
  DAILY
  WEEKLY
  MONTHLY
  CUSTOM
}

enum ReportStatus {
  DRAFT
  FINALIZED
}

enum DeliveryStatus {
  PENDING
  SENT
  FAILED
}
```

## 2. Organisational hierarchy

```prisma
model County {
  id          String      @id @default(cuid())
  code        String      @unique
  name        String
  subcounties Subcounty[]
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

model Subcounty {
  id        String @id @default(cuid())
  code      String @unique
  name      String
  countyId  String
  county    County @relation(fields: [countyId], references: [id])
  wards     Ward[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([countyId])
}

model Ward {
  id          String   @id @default(cuid())
  code        String   @unique
  name        String
  subcountyId String
  subcounty   Subcounty @relation(fields: [subcountyId], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([subcountyId])
}
```

Seed data: `County(code: "NCC", name: "Nairobi City County")`,
`Subcounty(code: "KIBRA", name: "Kibra", county: NCC)`,
`Ward(code: "MAKINA", name: "Makina", subcounty: Kibra)`.

## 3. Users, roles, capabilities, assignments

```prisma
model User {
  id                 String         @id @default(cuid())
  email              String         @unique
  displayName        String
  passwordHash       String
  active             Boolean        @default(true)
  mustChangePassword Boolean        @default(true)
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
  sessions           UserSession[]
  assignments        Assignment[]
  accessRequests     AccessRequest[]
  auditEvents        AuditEvent[]   @relation("AuditActor")
}

model Role {
  id          String       @id @default(cuid())
  code         RoleCode     @unique
  name         String
  capabilities RoleCapability[]
  assignments  Assignment[]
}

model Capability {
  id   String          @id @default(cuid())
  code CapabilityCode  @unique
  name String
  roles RoleCapability[]
}

model RoleCapability {
  roleId       String
  capabilityId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  capability   Capability @relation(fields: [capabilityId], references: [id], onDelete: Cascade)

  @@id([roleId, capabilityId])
}

model Assignment {
  id          String    @id @default(cuid())
  userId      String
  roleId      String
  scopeType   ScopeType
  countyId    String?
  subcountyId String?
  wardId      String?
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        Role      @relation(fields: [roleId], references: [id])

  // Exactly one scope id matches scopeType (enforced in application + DB check).
  @@unique([userId, roleId, scopeType, countyId, subcountyId, wardId])
  @@index([userId])
  @@index([wardId])
  @@index([subcountyId])
  @@index([countyId])
}

model UserSession {
  id          String    @id @default(cuid())
  userId      String
  tokenHash   String    @unique
  csrfToken   String
  createdAt   DateTime  @default(now())
  expiresAt   DateTime
  lastSeenAt  DateTime
  revokedAt   DateTime?
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model AccessRequest {
  id               String        @id @default(cuid())
  displayName      String
  email            String
  passwordHash     String
  reason           String
  status           String        @default("pending") // pending | approved | rejected
  requestedScope   ScopeType?
  requestedScopeId String?
  targetUserId     String?
  reviewedBy       String?
  reviewNote       String?
  createdAt        DateTime      @default(now())
  reviewedAt       DateTime?

  @@index([email])
  @@index([status])
}
```

## 4. Staff

```prisma
model Employee {
  id              String               @id @default(cuid())
  employeeNumber  String               // 11-digit, year-prefixed
  fullName        String
  phone           String
  email           String?
  designation     String               @default("Green Army Staff")
  active          Boolean              @default(true)
  wardId          String               // current ward
  ward            Ward                 @relation(fields: [wardId], references: [id])
  profile         EmployeeProfile?
  assignments     EmployeeAssignment[]
  attendance      Attendance[]
  absences        AbsenceRequest[]
  workLogs        WorkLog[]
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@unique([wardId, employeeNumber])   // unique within ward scope
  @@unique([phone])
  @@index([wardId])
  @@index([employeeNumber])
}

model EmployeeProfile {
  id           String   @id @default(cuid())
  employeeId   String   @unique
  residence    String?
  rosterStatus String   @default("on_duty") // on_duty | annual_leave
  updatedAt    DateTime @updatedAt
  employee     Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
}

model EmployeeAssignment {
  id         String    @id @default(cuid())
  employeeId String
  wardId     String
  assignedAt DateTime  @default(now())
  endedAt    DateTime?
  employee   Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@index([employeeId])
  @@index([wardId])
}
```

## 5. Attendance

```prisma
model AttendanceSession {
  id        String       @id @default(cuid())
  token     String       @unique
  wardId    String
  ward      Ward         @relation(fields: [wardId], references: [id])
  workDate  DateTime     @db.Date
  activity  String
  location  String
  opensAt   DateTime
  closesAt  DateTime
  createdAt DateTime     @default(now())
  createdBy String
  attendance Attendance[]

  @@index([wardId, workDate])
  @@index([workDate])
}

model Attendance {
  id         String           @id @default(cuid())
  employeeId String
  sessionId  String
  wardId     String
  workDate   DateTime         @db.Date
  checkedAt  DateTime
  status     AttendanceStatus
  latitude   Decimal?         @db.Decimal(9, 6)
  longitude  Decimal?         @db.Decimal(9, 6)
  employee   Employee         @relation(fields: [employeeId], references: [id])
  session    AttendanceSession @relation(fields: [sessionId], references: [id])

  @@unique([employeeId, workDate])
  @@index([wardId, workDate])
  @@index([workDate])
}
```

## 6. Absence / leave

```prisma
model AbsenceRequest {
  id         String        @id @default(cuid())
  employeeId String
  wardId     String
  kind       AbsenceKind
  startDate  DateTime      @db.Date
  endDate    DateTime      @db.Date
  returnDate DateTime      @db.Date
  reason     String
  status     AbsenceStatus @default(SUBMITTED)
  version    Int           @default(1)
  submittedBy String
  reviewedBy  String?
  reviewNote  String?
  createdAt  DateTime      @default(now())
  reviewedAt DateTime?
  employee   Employee      @relation(fields: [employeeId], references: [id])
  documents  Document[]
  deliveries ReminderDelivery[]

  @@index([employeeId, status, startDate, endDate])
  @@index([wardId])
  @@index([status])
}
```

Allowed transitions (explicit domain service, no workflow engine):

```
PLANNED    -> SUBMITTED | CANCELLED
SUBMITTED  -> APPROVED | REJECTED | CANCELLED
APPROVED   -> terminal (corrected only explicitly)
REJECTED   -> terminal
CANCELLED  -> terminal
```

## 7. Work logs

```prisma
model WorkLog {
  id           String          @id @default(cuid())
  wardId       String
  ward         Ward            @relation(fields: [wardId], references: [id])
  workDate     DateTime        @db.Date
  activity     String
  location     String
  description  String
  staffCount   Int             @default(0)
  challenges   String?
  status       WorkLogStatus   @default(SUBMITTED)
  version      Int             @default(1)
  submittedBy  String
  reviewedBy   String?
  reviewNote   String?
  createdAt    DateTime        @default(now())
  reviewedAt   DateTime?
  detail       WorkLogDetail?
  operations   WorkLogOperations?
  evidence     Evidence[]

  @@index([wardId, workDate])
  @@index([workDate])
  @@index([status])
}

model WorkLogDetail {
  id               String           @id @default(cuid())
  workLogId        String           @unique
  completionStatus CompletionStatus @default(COMPLETE)
  outstandingWork  String?
  workLog          WorkLog          @relation(fields: [workLogId], references: [id], onDelete: Cascade)
}

model WorkLogOperations {
  id                   String   @id @default(cuid())
  workLogId            String   @unique
  areasRoads           String
  numberOfTrips        Int      @default(0)
  wasteTransferInvolved Boolean @default(false)
  truckId              String?
  backhoeId            String?
  cleanupDone          Boolean  @default(false)
  cleanupStakeholders  String?
  climateTeamCount     Int      @default(0)
  workLog              WorkLog  @relation(fields: [workLogId], references: [id], onDelete: Cascade)
}
```

Transitions: `SUBMITTED -> APPROVED | REJECTED` (explicit, auditable; no
arbitrary mutation; corrections bump `version` and are audited).

## 8. Evidence (photos) and documents

```prisma
model Evidence {
  id           String         @id @default(cuid())
  workLogId    String
  objectKey    String         @unique
  stage        EvidenceStage
  caption      String?
  contentType  String
  size         Int
  sha256       String
  uploadedBy   String
  createdAt    DateTime       @default(now())
  workLog      WorkLog        @relation(fields: [workLogId], references: [id], onDelete: Cascade)

  @@index([workLogId])
}

model Document {
  id               String              @id @default(cuid())
  absenceRequestId String?
  objectKey        String              @unique
  originalName     String
  contentType      String
  size             Int
  sha256           String
  sensitivity      DocumentSensitivity @default(MEDICAL)
  uploadedBy       String
  createdAt        DateTime            @default(now())
  absenceRequest   AbsenceRequest?     @relation(fields: [absenceRequestId], references: [id], onDelete: SetNull)
  classification   DocumentClassification?

  @@index([absenceRequestId])
}

model DocumentClassification {
  id         String           @id @default(cuid())
  documentId String           @unique
  category   DocumentCategory
  document   Document         @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

## 9. Reports (immutable)

```prisma
model Report {
  id              String           @id @default(cuid())
  kind            ReportKind
  scopeType       ScopeType
  scopeId         String           // ward/subcounty/county id
  periodStart     DateTime         @db.Date
  periodEnd       DateTime         @db.Date
  status          ReportStatus     @default(DRAFT)
  title           String
  narrative       String
  recommendations String
  snapshot        Json             // immutable factual snapshot
  version         Int              @default(1)
  finalizedBy     String?
  finalizedAt     DateTime?
  createdBy       String
  createdAt       DateTime         @default(now())
  evidence        ReportEvidence[]

  @@index([scopeType, scopeId, periodStart, periodEnd])
  @@index([kind])
}

model ReportEvidence {
  id        String         @id @default(cuid())
  reportId  String
  evidenceId String?
  objectKey String
  sha256    String
  caption   String?
  stage     EvidenceStage
  report    Report         @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
}
```

## 10. Notifications / reminders

```prisma
model ReminderDelivery {
  id                String          @id @default(cuid())
  absenceRequestId  String
  reminderDays      Int
  recipient         String
  status            DeliveryStatus  @default(PENDING)
  message           String?
  createdAt         DateTime        @default(now())
  sentAt            DateTime?
  absenceRequest    AbsenceRequest  @relation(fields: [absenceRequestId], references: [id], onDelete: Cascade)

  @@unique([absenceRequestId, reminderDays])
  @@index([status])
}
```

## 11. Audit

```prisma
model AuditEvent {
  id          String    @id @default(cuid())
  occurredAt  DateTime  @default(now())
  actorUserId String?
  actor       User?     @relation("AuditActor", fields: [actorUserId], references: [id])
  action      String
  targetType  String
  targetId    String?
  scopeType   ScopeType?
  scopeId     String?
  details     String?
  sourceIp    String?
  requestId   String?

  @@index([occurredAt])
  @@index([action])
  @@index([actorUserId])
}
```

## 12. Integrity constraints & indexes

- Unique employee number within ward (`@@unique([wardId, employeeNumber])`).
- Unique attendance `(employeeId, workDate)`.
- Unique evidence/document object key.
- Unique reminder delivery `(absenceRequestId, reminderDays)`.
- Valid organisational FKs (ward → subcounty → county).
- Assignment scope column matches `scopeType` (DB CHECK + application).
- Indexes mirror query patterns: `wardId + workDate`, `employeeId + workDate`,
  `scope + report period`, `status`, `subcountyId`, `createdAt`.
