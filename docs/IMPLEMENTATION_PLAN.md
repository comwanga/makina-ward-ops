# Implementation Plan

## Product goal

Give the Makina Ward Environment Officer one reliable source for staff attendance, leave, sick-off records, daily work, and statutory reports while keeping staff check-in fast on low-cost Android phones.

## Architecture

The production system is a mobile-first web application with four boundaries:

1. Web application: supervisor dashboard, public time-limited check-in, report views, and installable PWA shell.
2. Application API: identity verification, attendance rules, leave workflows, work logs, reporting, and immutable audit events.
3. Data services: managed PostgreSQL for operational data and private object storage for medical documents/photos.
4. Background worker: email/SMS reminders, report generation, malware scanning, retention jobs, and optional AI report drafting.

The prototype uses FastAPI, server-rendered HTML, SQLAlchemy, and SQLite. SQLAlchemy permits migration to PostgreSQL without changing domain rules. A single deployable service is preferable initially; splitting into microservices would add operational cost without a demonstrated scaling need.

## Delivery phases

### Phase 1: Operational vertical slice

- Official employee register and basic validation.
- Expiring daily QR attendance session.
- Employee verification, duplicate prevention, timestamp, and optional GPS.
- Live present/late/absent/leave/sick-off roster.
- Planned leave and 30-day reminder queue.
- Sick-off reason and medical document intake.
- Printable daily staff return.

Status: implemented.

### Phase 2: Secure pilot

- County SSO where available, otherwise passwordless supervisor login with MFA.
- Roles: Ward Officer, Sub County Reviewer, HR Viewer, and System Administrator.
- PostgreSQL migrations, encrypted backups, private S3-compatible storage, and malware scanning.
- Attendance session geofence and server-side distance validation.
- Approval workflows, corrections with reason, and append-only audit history.
- Transactional email provider with 30-, 14-, and 7-day leave reminders.
- CSV employee import and approved Nairobi City County report templates/logo.
- PWA offline queue for unreliable connectivity.
- Pilot with synthetic data, then 10-20 consenting employees.

Status: application controls are implemented. County SSO, external malware scanning, approved hosting and the formal privacy assessment are deployment/organisational gates.

### Phase 3: Reporting and field work

- Daily work activity, location, quantities, challenges, photos, and supervisor sign-off.
- Weekly/monthly aggregation and Excel/PDF exports.
- Scheduled report delivery to approved recipients.
- Return-to-work confirmations, leave balances, and exception dashboards.
- Sub County dashboard with ward-level access controls.

Status: single-ward work logs, approvals, period reports, immutable snapshots, print/PDF and CSV are implemented. Multi-ward tenancy remains out of scope for Makina Ward deployment.

### Phase 4: Controlled AI assistance

- Generate narrative drafts only from approved structured records.
- Use retrieval-free prompts that do not invent quantities, names, or activities.
- Require officer review before release and preserve the edited final version.
- Use a provider and hosting region approved for county information.
- Never send medical documents, phone numbers, or unnecessary identifiers to the model.

Status: implemented behind `AI_ENABLED=false` with a deterministic non-AI fallback. Provider approval is required before enabling it.

## Core data model

- Employee: official identifier, identity/contact details, role, status.
- AttendanceSession: random token, ward, work date, activity, location, open/close times, geofence.
- Attendance: employee/day uniqueness, check-in/out, status, coordinates, verification method.
- Absence: leave or sick-off period, return date, reason, evidence reference, approval state.
- PlannedLeave: schedule, type, reminder state, application and approval state.
- WorkLog: date, activity, location, output quantities, challenges, photographs.
- AuditEvent: actor, action, target, timestamp, before/after values, reason, request metadata.

## Security and privacy gates

- Complete a Kenya Data Protection Act impact assessment and define the lawful basis before collecting real records.
- Collect only necessary data; avoid selfies/biometrics unless explicitly justified and approved.
- Treat medical evidence as sensitive personal data with separate permissions and short retention.
- Encrypt in transit and at rest; keep uploads private and serve through short-lived signed links.
- QR tokens must be random, short-lived, single-purpose, and rate-limited. A QR alone is not identity proof.
- Validate geolocation server-side and provide a supervised fallback for staff without smartphones.
- Log exports, approvals, corrections, and access to sensitive files.
- Publish staff notices covering purpose, retention, access, correction, and complaint channels.

## Acceptance criteria for pilot

- A staff member completes check-in in under 30 seconds on a basic Android phone.
- No duplicate attendance exists for an employee and work date.
- Expired or invalid QR tokens cannot record attendance.
- Dashboard totals reconcile exactly with the generated staff return.
- Leave automatically prevents an employee being reported as absent.
- Reminder jobs are idempotent and their delivery state is auditable.
- Medical files are inaccessible without an authorised, logged-in role.
- Daily, weekly, and monthly reports pass officer and HR template review.

## Decisions needed before secure pilot

- Obtain the authoritative employee CSV and field definitions.
- Obtain approved daily, weekly, monthly, and staff-return templates.
- Confirm whether staff have county email addresses; select email/SMS fallback.
- Define attendance hours, late threshold, geofence radius, and correction authority.
- Confirm hosting, data residency, retention periods, and official logo approval.
