# Makina Ward Ops — Multi-Ward Operations Platform Rewrite

## Mission

Perform a clean, production-oriented rewrite of the existing **Makina Ward Ops** application into a scalable **multi-ward and multi-subcounty environment operations platform**.

Existing repository:

`comwanga/makina-ward-ops`

The existing application is the **behavioral and domain reference**, not the architectural template.

Study the existing repository thoroughly before implementation.

Preserve validated business rules, workflows, security requirements, reporting behavior, terminology, and useful UX.

Do NOT mechanically translate Python files into TypeScript.

Do NOT reproduce known architectural weaknesses.

The new system must be designed so that:

> Makina Ward is the first organisational scope using the platform, not a hard-coded assumption throughout the application.

The architecture must support expansion:

```text
Makina Ward
    ↓
Kibra Subcounty
    ↓
Other Subcounties
    ↓
Nairobi City County
```

without requiring separate application deployments or databases for every ward.

---

# 1. Mandatory Technology Stack

Freeze the following stack unless a concrete technical blocker is discovered and documented.

## Frontend

```text
Next.js
React
TypeScript
```

Use modern Next.js App Router architecture.

The frontend must be:

* mobile-first
* responsive
* accessible
* installable as a PWA if justified
* optimized for field use
* tolerant of slow mobile connections

Do not introduce another frontend framework.

---

## Backend

```text
NestJS
Fastify adapter
TypeScript
```

NestJS owns:

* business rules
* authentication
* authorization
* tenant/scope enforcement
* attendance
* staff management
* absence management
* work logs
* evidence management
* approvals
* reporting
* audit events
* notifications
* storage orchestration

Fastify is the NestJS HTTP adapter.

Do not build duplicate business logic inside Next.js.

The architectural boundary is:

```text
Next.js = presentation

NestJS = authoritative business logic

PostgreSQL = structured source of truth

Object Storage = binary evidence
```

---

# 2. Database

Use:

```text
PostgreSQL
```

PostgreSQL is the authoritative structured datastore.

Do NOT introduce:

* MongoDB
* DynamoDB
* multiple operational databases
* separate database per ward

Use one properly scoped relational model.

---

# 3. ORM

Use:

```text
Prisma
```

Do not introduce both Prisma and Drizzle.

Prisma owns:

* schema
* migrations
* typed database client
* relations
* constraints

Use database constraints for critical integrity rules rather than relying only on application validation.

---

# 4. Validation

Use:

```text
Zod
```

for shared/external data contracts where practical.

NestJS DTO validation may be used where Nest integration materially improves the implementation.

Avoid maintaining multiple contradictory validation definitions.

Validation must occur server-side regardless of frontend validation.

---

# 5. Storage

Use:

```text
S3-compatible object storage
```

for:

* work evidence photos
* medical/supporting documents
* generated binary artifacts where appropriate

Do NOT store production uploads on the application container filesystem.

The architecture must eliminate the existing class of failure where:

```text
database metadata survives
+
container filesystem disappears
=
broken evidence
```

Store object metadata in PostgreSQL.

Prefer opaque/random object keys.

Do not expose permanent public object URLs.

Objects must remain private.

Access must pass through authorized application logic or short-lived signed URLs.

---

# 6. Deployment

Initial deployment:

```text
Docker
Railway
```

Expected initial topology:

```text
Railway Project
│
├── web
│    Next.js
│
├── api
│    NestJS + Fastify
│
└── PostgreSQL

External / compatible service
│
└── S3 object storage
```

Do NOT introduce Kubernetes.

Do NOT introduce a service mesh.

Do NOT create microservices.

---

# 7. Architecture Philosophy

Build a:

# Multi-tenant Modular Monolith

Do not confuse a monorepo with microservices.

Use one repository with clear application/package boundaries.

Recommended structure:

```text
ward-ops/
│
├── apps/
│   │
│   ├── web/
│   │   └── Next.js
│   │
│   └── api/
│       └── NestJS
│
├── packages/
│   │
│   ├── contracts/
│   ├── validation/
│   ├── database/
│   ├── config/
│   └── shared/
│
├── prisma/
│
├── infrastructure/
│
├── docs/
│
└── tests/
```

Do not create packages without a demonstrated boundary.

---

# 8. First Phase — Understand Existing Makina Ward Ops

Before implementing anything, audit:

```text
app/
templates/
static/
tests/
docs/
Dockerfile
railway.json
.env.example
requirements*.txt
```

Document:

* existing entities
* user roles
* authentication
* permissions
* attendance
* staff
* leave/absence
* work logs
* evidence
* approvals
* reporting
* notifications
* audit logging
* AI functionality
* deployment assumptions
* existing tests

Produce:

```text
docs/LEGACY_BEHAVIOR.md
```

Classify existing behavior as:

```text
PRESERVE
IMPROVE
REPLACE
REMOVE
```

Do not reproduce legacy behavior merely because it exists.

---

# 9. Organisational Hierarchy

The new system must model organisational structure explicitly.

Minimum hierarchy:

```text
County
   │
   └── Subcounty
          │
          └── Ward
```

Makina becomes data:

```text
County
Nairobi City County

    ↓

Subcounty
Kibra

    ↓

Ward
Makina
```

Never hard-code Makina into business logic.

Names and branding may be configuration/data.

---

# 10. Multi-Tenancy

Every operational resource must belong to an appropriate organisational scope.

Examples:

```text
Employee
Attendance
AttendanceSession
WorkLog
Evidence
AbsenceRequest
Report
```

Tenant isolation must be enforced by the backend.

Never trust a client-supplied:

```text
wardId
subcountyId
countyId
```

without checking the authenticated user's assignments.

A URL parameter is not authorization.

---

# 11. User Assignment Model

Do NOT model authorization solely as:

```text
User.role
```

Introduce organisational assignments.

Conceptually:

```text
User
   │
   └── Assignment
          │
          ├── role
          ├── scopeType
          └── scopeId
```

Example:

```text
User A
WARD_OFFICER
WARD
Makina

User B
REVIEWER
SUBCOUNTY
Kibra

User C
ADMINISTRATOR
COUNTY
Nairobi
```

A user may have multiple assignments if required.

---

# 12. Authorization Model

Authorization must evaluate:

```text
authenticated user
+
role
+
organisational assignment
+
requested resource scope
+
required capability
```

Do not repeat authorization manually in every controller.

Create centralized guards/policies.

Example conceptual flow:

```text
Request work log 123
        ↓
Authenticate
        ↓
Load organisational ownership
        ↓
Resolve user's assignments
        ↓
Evaluate capability + scope
        ↓
ALLOW / DENY
```

Default:

# DENY

Missing permissions must never mean unrestricted access.

This deliberately corrects the legacy fail-open scope behavior.

---

# 13. Initial Role Set

Use existing business roles as the starting point.

Map and refine:

```text
SYSTEM_ADMIN
WARD_OFFICER
SUBCOUNTY_REVIEWER
HR_VIEWER
READ_ONLY
```

Do not hard-code permissions throughout controllers.

Define capabilities centrally.

Examples:

```text
staff.read
staff.manage

attendance.read
attendance.manage

work.read
work.create
work.review

absence.read
absence.manage
absence.review

medical.read

reports.read
reports.finalize

audit.read

users.manage
```

Then combine:

```text
Role
+
Assignment
+
Capability
```

---

# 14. Authentication

Preserve the security strengths of the existing application.

Implement secure authentication appropriate for a browser-based operational system.

Requirements:

* strong password hashing
* secure session/token handling
* expiration
* logout
* revocation
* password change
* account disabling
* audit events
* login throttling
* secure cookies if cookie-based
* CSRF protection where applicable

Do not invent a custom authentication protocol.

Prefer server-controlled browser authentication.

Avoid storing long-lived authentication secrets in `localStorage`.

---

# 15. Staff Domain

Implement staff management as an independent domain.

Minimum employee information should be derived from existing validated requirements.

Do not blindly migrate every legacy field.

Support:

* employee number
* name
* role/designation
* phone where required
* email where required
* active/inactive
* ward assignment
* operational profile information

Historical operational records must not disappear merely because an employee becomes inactive or moves ward.

---

# 16. Attendance

Preserve the useful existing attendance workflow.

Support:

```text
attendance session
QR attendance
supervised/manual attendance
present
late
absent
off duty
leave
sick off
official duty
```

Use business rules rather than frontend assumptions.

Critical database invariant:

```text
employee + workDate
```

must prevent duplicate attendance where appropriate.

Attendance records must carry organisational scope.

---

# 17. Attendance Session Security

QR attendance must not simply encode unrestricted employee identifiers.

Sessions must:

* expire
* be server-generated
* be unguessable
* be tied to the correct ward
* prevent duplicate check-in
* validate employee eligibility

Use Nairobi timezone consistently for operational dates.

---

# 18. Absence and Leave

Replace the legacy dual absence model with one coherent model.

Support required states such as:

```text
PLANNED
SUBMITTED
APPROVED
REJECTED
CANCELLED
```

Implement explicit allowed transitions.

Example:

```text
PLANNED
   ├── SUBMITTED
   └── CANCELLED

SUBMITTED
   ├── APPROVED
   ├── REJECTED
   └── CANCELLED

APPROVED
   └── terminal unless explicitly corrected

REJECTED
   └── terminal

CANCELLED
   └── terminal
```

Do not introduce a workflow engine.

Use a small explicit domain transition service.

---

# 19. Medical and Supporting Documents

Documents are sensitive.

Store binary content in private S3-compatible storage.

PostgreSQL stores:

```text
id
objectKey
originalName
contentType
size
sha256
uploadedBy
createdAt
relatedEntity
```

Do not store arbitrary absolute URLs.

Access requires explicit authorization.

Medical-document access must be more restrictive than ordinary work evidence where policy requires it.

All access should be auditable if appropriate.

---

# 20. Work Logs

Preserve the operational workflow of the existing system.

Work logs should support:

* date
* activity
* location
* areas/roads
* description
* staff count
* trips
* waste-transfer involvement
* truck ID
* backhoe ID
* cleanup activity
* stakeholders
* Climate Works participation where relevant
* challenges
* completion state
* outstanding work
* evidence

Work logs belong to a ward.

---

# 21. Work-Log Workflow

Implement explicit transitions.

Minimum:

```text
SUBMITTED
    ├── APPROVED
    └── REJECTED
```

Approved/rejected records must not silently move into another state.

Corrections should be explicit and auditable.

Do not permit arbitrary status mutation.

---

# 22. Evidence Model

Do not model evidence as arbitrary files.

Use an explicit Evidence entity.

Example:

```text
Evidence
│
├── id
├── workLogId
├── objectKey
├── stage
├── caption
├── contentType
├── size
├── sha256
├── uploadedBy
└── createdAt
```

Stages:

```text
BEFORE
DURING
AFTER
```

Maintain limits based on actual product requirements.

---

# 23. Image Upload Pipeline

Design for field phones.

Target:

```text
Phone
  │
  ▼
Validation
  │
  ▼
Orientation normalization
  │
  ▼
Resize
  │
  ▼
Compression
  │
  ▼
S3 object storage
  │
  ├── object metadata → PostgreSQL
  │
  └── private object
```

Do not upload enormous original phone images unnecessarily.

Validate:

* file signature
* supported formats
* maximum bytes
* maximum dimensions where appropriate

Do not trust filename extensions.

Prevent SVG/HTML/script upload where not explicitly required.

---

# 24. Storage Consistency

Handle partial failure carefully.

Example:

```text
object upload succeeds
DB transaction fails
```

must not silently create permanent orphaned objects.

Likewise:

```text
DB metadata exists
object missing
```

must be detectable.

Create lightweight reconciliation capabilities.

Do not build distributed transactions.

Use compensating cleanup.

---

# 25. Reporting Architecture

Reports must remain deterministic.

Architecture:

```text
PostgreSQL operational data
          │
          ▼
Deterministic aggregation
          │
          ▼
Structured report snapshot
          │
          ├── official totals
          ├── attendance
          ├── work outputs
          ├── evidence references
          └── metadata
          │
          ▼
Optional AI narrative
          │
          ▼
Human review
          │
          ▼
Finalized report
```

AI must never calculate authoritative statistics.

---

# 26. Report Hierarchy

Design reporting so the same model scales upward.

### Ward

```text
Makina Ward Report
```

### Subcounty

Aggregate authorized ward facts:

```text
Kibra Subcounty Report
```

### County

Aggregate authorized subcounty/ward facts:

```text
Nairobi City County Environment Operations
```

Do not duplicate report engines for each level.

Build reusable deterministic aggregation.

---

# 27. Immutable Reports

When a report is finalized, persist an immutable snapshot.

The report must not silently change because:

* employee name changed
* work log changed
* attendance corrected
* organizational structure changed

after finalization.

Store the factual snapshot used to produce the final report.

Record:

```text
finalizedBy
finalizedAt
scope
period
snapshot
narrative
recommendations
version
```

---

# 28. Evidence and Final Reports

Make an explicit design decision for photographic evidence.

A finalized report should preserve enough information to prove which evidence supported it.

At minimum store immutable:

```text
evidence ID
object key/reference
SHA-256
caption
stage
```

If business requirements require reports to remain visually complete even after canonical evidence lifecycle changes, preserve report-specific evidence references/copies.

Document the chosen policy.

---

# 29. Report Exports

Support practical exports.

Priority:

```text
HTML/browser report
Print / Save PDF
CSV/XLSX where operationally useful
```

Do not build a complex reporting engine prematurely.

Use server-generated structured data.

---

# 30. AI Assistance

AI remains OPTIONAL.

The platform must work fully without an AI provider.

AI may:

* draft executive summaries
* improve wording
* summarize deterministic facts
* draft recommendations grounded in supplied information

AI may NOT:

* invent attendance
* invent staff
* invent locations
* invent work
* invent quantities
* calculate authoritative official totals
* determine approval state

Use structured minimized payloads.

Do not send unnecessary personnel or medical information to AI providers.

---

# 31. Audit Logging

Maintain append-oriented audit events for important actions.

Examples:

```text
LOGIN_SUCCESS
LOGIN_FAILURE
PASSWORD_CHANGED

USER_CREATED
USER_DISABLED
ASSIGNMENT_CHANGED

ATTENDANCE_CREATED
ATTENDANCE_CORRECTED

ABSENCE_SUBMITTED
ABSENCE_APPROVED
ABSENCE_REJECTED

WORK_SUBMITTED
WORK_APPROVED
WORK_REJECTED

REPORT_FINALIZED

SENSITIVE_DOCUMENT_ACCESSED
```

Audit logs should identify:

```text
actor
action
resource
timestamp
scope
relevant metadata
```

Never log passwords, tokens or sensitive document contents.

---

# 32. Notifications

Keep notifications simple.

Initial implementation may use:

```text
NestJS scheduled task
+
SMTP/email provider
+
database delivery records
```

Delivery records should support:

```text
PENDING
SENT
FAILED
```

with bounded retries.

Do NOT introduce Redis/BullMQ initially unless actual job volume/reliability requirements justify it.

Design the notification interface so a queue can be added later without rewriting the business domain.

---

# 33. Background Processing

Initially use application-level background/scheduled processing only for small workloads.

Candidates:

* leave reminders
* lightweight cleanup
* storage reconciliation

Heavy image transformation may occur asynchronously only if measurements show synchronous upload processing is problematic.

Do not introduce infrastructure based on hypothetical future load.

---

# 34. Frontend Architecture

Next.js owns presentation and user interaction.

Recommended feature organization:

```text
app/
│
├── (auth)/
│
├── dashboard/
├── staff/
├── attendance/
├── absences/
├── work/
├── reports/
├── administration/
└── account/
```

Keep reusable UI in:

```text
components/
```

Do not duplicate API business rules in frontend code.

---

# 35. Dashboards by Organisational Scope

The dashboard should adapt to authorization.

## Ward officer

See assigned ward operations.

## Subcounty reviewer

See aggregated authorized wards.

## County administrator

See authorized county-level information.

Conceptually:

```text
County Dashboard
       │
       ▼
Subcounty
       │
       ▼
Ward
       │
       ▼
Operational Detail
```

Users must never receive unauthorized tenant data merely because the UI hides it.

Backend filtering is mandatory.

---

# 36. Mobile-First UX

Field operations are a first-class requirement.

Optimize:

* navigation
* attendance
* photo capture
* uploads
* forms
* report viewing
* touch targets
* low-bandwidth behavior

Provide clear:

```text
loading
uploading
success
failure
retry
empty
offline/unavailable
```

states.

Prevent accidental duplicate form submission.

---

# 37. PWA

Implement PWA capabilities only where they provide real field value.

Reasonable initial functionality:

* installability
* application-shell caching
* static assets
* basic offline screen

Do NOT immediately implement complex offline mutation synchronization.

Offline attendance/work-log synchronization is a separate architecture problem and must not be silently introduced.

Design APIs so it can be added later if field evidence proves it necessary.

---

# 38. Shared Contracts

Use shared TypeScript contracts where this genuinely reduces drift.

Example package:

```text
packages/contracts
```

Use it for:

* enums
* response shapes
* reusable schemas
* pagination
* API error structures

Do not expose Prisma models directly as public API contracts.

Database representation and API representation must remain conceptually separate.

---

# 39. API Design

Use predictable REST APIs.

Examples:

```text
/api/v1/auth/...

/api/v1/staff
/api/v1/attendance
/api/v1/absence-requests
/api/v1/work-logs
/api/v1/reports
/api/v1/evidence
/api/v1/admin/...
```

Use consistent:

* status codes
* errors
* pagination
* filtering
* validation

Do not add GraphQL.

---

# 40. API Error Contract

Define one standard error shape.

Example:

```json
{
  "error": {
    "code": "WORK_LOG_INVALID_TRANSITION",
    "message": "This work log can no longer be approved."
  }
}
```

Do not leak:

* SQL errors
* stack traces
* filesystem paths
* secrets

to clients.

---

# 41. Database Integrity

Use PostgreSQL constraints for important invariants.

Examples:

```text
unique employee number within required scope

unique attendance employee/date

valid organisational relationships

unique evidence object key

valid report scope

unique reminder delivery identity
```

Application validation complements database constraints; it does not replace them.

---

# 42. Indexing

Add indexes based on expected query patterns.

Likely candidates should be verified:

```text
ward_id + work_date
employee_id + work_date
scope + report period
status
subcounty_id
created_at
```

Do not index every column.

Document why each non-obvious index exists.

---

# 43. Data Migration

Do NOT migrate real legacy production data automatically during initial development.

First build:

```text
docs/MIGRATION_PLAN.md
```

Map:

```text
old model
→ new model
```

for:

* users
* employees
* attendance
* absences
* work logs
* photos
* reports
* audit events where applicable

The migration must preserve historical integrity.

Use synthetic/test copies before production migration.

---

# 44. Evidence Migration

Legacy filesystem evidence requires special handling.

Migration must verify:

```text
DB record exists
+
legacy file exists
+
SHA-256 matches
```

before uploading to S3-compatible storage.

Migration flow:

```text
legacy storage key
      │
      ▼
read file
      │
      ▼
verify SHA-256
      │
      ▼
upload object
      │
      ▼
verify object
      │
      ▼
create/update new metadata
```

Missing legacy files must be reported.

Never fabricate evidence.

---

# 45. Security Headers

Configure appropriate production headers.

Include where applicable:

* Content-Security-Policy
* X-Content-Type-Options
* frame restrictions
* Referrer-Policy
* Permissions-Policy
* HSTS after HTTPS deployment is verified

Do not weaken CSP for convenience.

---

# 46. Secrets

Secrets must come from environment configuration.

Never commit:

```text
database passwords
session secrets
API keys
SMTP passwords
object-storage credentials
AI keys
```

Validate required production environment variables at startup.

Fail clearly when critical configuration is missing.

---

# 47. Observability

Keep observability practical.

Implement:

```text
structured application logs
request correlation ID
health endpoint
readiness endpoint
storage errors
database errors
authentication events
notification errors
AI-provider failures
```

Never log:

* passwords
* tokens
* private document content
* sensitive medical content

Do not introduce a distributed tracing platform initially.

---

# 48. Health Checks

Provide:

```text
/health/live
/health/ready
```

`live` answers:

> Is the process alive?

`ready` answers:

> Can the application safely serve requests?

Readiness should verify critical dependencies without performing expensive operations.

---

# 49. Testing Strategy

Prioritize behavior over coverage percentage.

## Unit tests

Business rules:

* permissions
* organisational scopes
* workflow transitions
* reporting aggregation

## Integration tests

* PostgreSQL
* Prisma
* auth
* API
* object-storage adapter

## E2E tests

Critical flow:

```text
login
→ create/identify staff
→ attendance
→ create work log
→ upload evidence
→ reload evidence
→ review
→ approve
→ generate report
→ finalize report
→ retrieve report
```

Also test cross-tenant isolation.

---

# 50. Mandatory Multi-Tenant Security Tests

Create tests proving:

```text
Makina officer
CANNOT
read another ward's work log
```

and:

```text
Makina officer
CANNOT
modify another ward's attendance
```

and:

```text
Ward officer
CANNOT
escalate scope through request parameters
```

and:

```text
Subcounty reviewer
CAN
access authorized wards
```

and:

```text
County-level user
CAN
access only assigned county scope
```

These are release-critical tests.

---

# 51. Evidence Tests

Test:

```text
upload
retrieve
authorization
invalid signature
oversized file
missing object
hash mismatch where applicable
DB failure after upload
storage failure
cross-tenant access
```

The broken-photo class of failure from the legacy application must have regression coverage.

---

# 52. CI

Create minimal GitHub Actions CI.

Required merge gates:

```text
install
lint
typecheck
test
build
```

For both:

```text
web
api
```

Run database integration tests against PostgreSQL where required.

Do not create a complicated release-management system.

---

# 53. Docker

Provide production Dockerfiles.

Prefer reproducible multi-stage builds.

Run containers as non-root where practical.

Do not bake secrets into images.

Keep web and API independently deployable while remaining one logical application.

---

# 54. Railway

Prepare Railway configuration for:

```text
web
api
PostgreSQL
```

Document all required environment variables.

Do not rely on ephemeral container storage for user-generated evidence.

Add deployment verification documentation.

---

# 55. Performance

Do not optimize hypothetically.

Design sensible boundaries:

* paginated lists
* bounded queries
* image compression
* thumbnails where useful
* database indexes
* report aggregation
* avoid N+1 queries

Measure before introducing caches.

---

# 56. Caching

Start with minimal caching.

Do NOT introduce Redis initially.

Use normal:

* browser caching
* Next.js asset caching
* HTTP caching where safe
* object-storage/CDN capabilities for authorized evidence only where security permits

Never cache sensitive cross-tenant responses incorrectly.

Correctness beats caching sophistication.

---

# 57. Scaling Strategy

The application must scale first through:

```text
good relational design
tenant isolation
stateless application services
object storage
database indexing
pagination
efficient queries
```

not through microservices.

Expected evolution:

```text
1 ward
   ↓
multiple wards
   ↓
one subcounty
   ↓
multiple subcounties
   ↓
county-wide
```

The same application should support all stages.

---

# 58. Explicitly Do NOT Build Yet

Do not implement:

* Kubernetes
* microservices
* Kafka
* RabbitMQ
* Redis unless measured need appears
* Elasticsearch
* GraphQL
* event sourcing
* CQRS
* data lake
* vector database
* custom IAM platform
* separate database per ward
* blockchain
* multiple AI agents
* complex GIS
* predictive ML
* native Android/iOS apps
* complex offline synchronization
* biometric attendance

Document these as deferred possibilities only if a real future use case exists.

---

# 59. Implementation Phases

Do not attempt the entire rewrite in one uncontrolled pass.

## Phase 0 — Discovery and Architecture Freeze

Deliver:

```text
LEGACY_BEHAVIOR.md
ARCHITECTURE.md
DOMAIN_MODEL.md
AUTHORIZATION_MODEL.md
MIGRATION_PLAN.md
ADR records
```

No production implementation until domain assumptions are verified.

---

## Phase 1 — Foundation

Implement:

* monorepo
* Next.js
* NestJS/Fastify
* PostgreSQL
* Prisma
* environment validation
* Docker
* health checks
* CI
* base API contracts

Acceptance:

```text
web builds
api builds
database migrations execute
CI passes
containers start
health checks pass
```

---

## Phase 2 — Organisation + Authentication

Implement:

```text
County
Subcounty
Ward
User
Role
Assignment
Authentication
Authorization
Audit
```

Acceptance requires cross-tenant isolation tests.

---

## Phase 3 — Staff + Attendance

Implement:

```text
staff
staff assignment
attendance sessions
QR attendance
manual attendance
attendance status
```

Validate Makina workflow against legacy behavior.

---

## Phase 4 — Absence Management

Implement:

```text
absence request
leave
sick off
official duty
documents
approval workflow
reminders
```

Remove legacy dual-model concepts from the new architecture.

---

## Phase 5 — Work Operations

Implement:

```text
work logs
operational details
completion
outstanding work
approval
audit
```

---

## Phase 6 — Evidence

Implement:

```text
private S3 storage
image validation
compression
metadata
authorization
before/during/after evidence
failure compensation
```

Explicitly regression-test the legacy broken-photo failure mode.

---

## Phase 7 — Reporting

Implement:

```text
ward reports
immutable snapshots
CSV/export
evidence references
approval/finalization
```

Then generalize aggregation for:

```text
subcounty
county
```

Do not duplicate reporting implementations.

---

## Phase 8 — Optional AI

Implement only after deterministic reporting is complete.

AI must remain optional.

---

## Phase 9 — Migration Tooling

Build tested migration utilities for:

```text
legacy database
legacy photos
new PostgreSQL schema
new object storage
```

Never migrate unverified/corrupt evidence silently.

Produce migration reports.

---

## Phase 10 — Production Hardening

Verify:

```text
security
backup
restore
object storage
tenant isolation
load behavior
Railway
environment configuration
logs
monitoring
CI/CD
```

Perform synthetic end-to-end recovery test.

---

# 60. Definition of Done

The rewrite is NOT complete merely because the UI looks similar to the old application.

It is complete when:

### Architecture

* Makina is data, not hard-coded architecture.
* Multiple wards can coexist.
* Multiple subcounties can coexist.
* one deployment supports them.

### Security

* scope isolation is enforced server-side.
* missing permissions fail closed.
* sensitive evidence is private.
* authentication is revocable.
* audit events exist.

### Operations

* attendance works.
* absence management works.
* work logs work.
* evidence survives deployment.
* approvals are state-safe.
* reports are deterministic.

### Reporting

* finalized reports preserve immutable facts.
* ward aggregation works.
* architecture supports subcounty/county aggregation.

### Reliability

* database backups are documented.
* object-storage backup/lifecycle policy is documented.
* restore has been tested using synthetic data.

### Engineering

* CI passes.
* migrations are reproducible.
* critical E2E tests pass.
* tenant-isolation tests pass.
* production Docker builds pass.

---

# 61. Final Engineering Rule

For every architectural decision ask:

> Does this solve a demonstrated requirement of a multi-ward environment operations platform?

If **yes**, implement the smallest reliable solution.

If **no**, defer it.

The desired architecture is:

```text
                        ┌────────────────────┐
                        │  Next.js / React   │
                        │    TypeScript      │
                        └─────────┬──────────┘
                                  │
                                  │ HTTPS
                                  ▼
                        ┌────────────────────┐
                        │      NestJS        │
                        │ Fastify + TS       │
                        └─────────┬──────────┘
                                  │
               ┌──────────────────┼──────────────────┐
               │                  │                  │
               ▼                  ▼                  ▼
        ┌────────────┐     ┌────────────┐      ┌────────────┐
        │ PostgreSQL │     │ S3 Storage │      │ SMTP / AI  │
        │  + Prisma  │     │  Evidence  │      │  Optional  │
        └─────┬──────┘     └────────────┘      └────────────┘
              │
              ▼
      ┌─────────────────┐
      │     County      │
      │       ↓         │
      │   Subcounty     │
      │       ↓         │
      │      Ward       │
      │       ↓         │
      │ Operational Data│
      └─────────────────┘
```

Keep this architecture simple until actual measurements or requirements prove it needs to become more complex.

---

# 62. Execution Protocol

Before writing production code:

1. Audit the legacy repository.
2. Produce Phase 0 documentation.
3. Produce the proposed Prisma domain model.
4. Produce the authorization matrix.
5. Produce ADRs for major architectural decisions.
6. Produce the migration mapping.
7. Identify unresolved business-rule questions.
8. STOP.

Present those artifacts for human review.

Do not proceed into the implementation phases until the architecture and domain model have been approved.

Once approved, implement **one phase at a time**.

After each phase:

```text
implement
   ↓
lint
   ↓
typecheck
   ↓
unit tests
   ↓
integration tests
   ↓
E2E where applicable
   ↓
security/scope verification
   ↓
document
   ↓
commit-ready checkpoint
```

Do not silently continue into the next phase if acceptance criteria fail.

At every checkpoint report:

* what changed
* files/modules added
* database migrations
* tests added
* test results
* unresolved risks
* deviations from architecture
* next phase

Never hide failing tests.

Never mark incomplete work as complete.

The goal is not maximum code output.

The goal is a **small, secure, maintainable multi-ward operations platform that can grow from Makina Ward to Kibra Subcounty and eventually county-wide without requiring another architectural rewrite.**
