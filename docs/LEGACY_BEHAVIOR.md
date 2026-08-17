# Legacy Behavior Audit — Makina Ward Ops

This document records the behavior of the existing FastAPI application
(`comwanga/makina-ward-ops`) so it can serve as the behavioral and domain
reference for the rewrite. It is *not* the architectural template.

Each behavior is classified as:

- **PRESERVE** — validated rule/workflow that must survive the rewrite.
- **IMPROVE** — useful behavior that should be kept but implemented more safely/cleanly.
- **REPLACE** — behavior that exists but is superseded by the new model.
- **REMOVE** — legacy behavior or technical debt that must not be reproduced.

## Source audit

| Area | Files |
|---|---|
| Models | `app/models.py` |
| Routes / controllers | `app/main.py` |
| Auth | `app/auth.py` |
| Audit | `app/audit.py` |
| Notifications | `app/notifications.py` |
| Reporting | `app/reporting.py` |
| Services / roster | `app/services.py` |
| Roster import | `app/importing.py` |
| Config | `app/config.py` |
| Database | `app/database.py` |
| UI | `templates/*.html`, `static/*.css`, `static/app.js` |
| Tests | `tests/test_app.py` (607 lines, 20 tests) |
| Docs | `README.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/OPERATIONS.md`, `docs/RAILWAY.md` |

## 1. Entities (existing)

- `Employee` — employee_number (unique, 11-digit year-prefixed), full_name,
  phone (unique, Kenyan), email (optional), role, active.
- `EmployeeProfile` — residence, roster_status (on_duty / annual_leave).
- `AttendanceSession` — random token, work_date, activity, location,
  opens_at, closes_at.
- `Attendance` — employee_id, session_id, work_date, checked_at, status,
  latitude, longitude. **Unique (employee_id, work_date).**
- `Absence` (legacy) — kind, start/end/return dates, reason, attachment_name,
  approval_status.
- `PlannedLeave` (legacy) — leave_type, dates, status, reminder_sent_at.
- `AbsenceRequest` — kind, dates, reason, status, submitted_by, reviewed_by,
  review_note, created/reviewed_at.
- `Document` — storage_key, original_filename, content_type, size_bytes,
  sha256, sensitivity, uploaded_by, uploaded_at.
- `DocumentClassification` — category (sick_sheet, medical_certificate,
  leave_form, leave_approval, return_to_work, other).
- `User` — email, display_name, password_hash, role, permissions (CSV),
  active, must_change_password.
- `UserSession` — token_hash, csrf_token, created/expires/last_seen/revoked.
- `AccessRequest` — display_name, email, password_hash, reason, status,
  requested_scope, target_user_id, review metadata.
- `AuditEvent` — occurred_at, actor_user_id, action, target_type, target_id,
  details, source_ip.
- `WorkLog` — work_date, activity, location, description, quantity, unit,
  staff_count, challenges, status, submitted_by, reviewed_by, review_note.
- `WorkLogDetail` — completion_status (complete/incomplete), outstanding_work.
- `WorkLogOperations` — areas_roads, number_of_trips, waste_transfer_involved,
  truck_id, backhoe_id, cleanup_done, cleanup_stakeholders, climate_team_count.
- `WorkPhoto` — storage_key, original_filename, content_type, size_bytes,
  sha256, caption, uploaded_by, uploaded_at.
- `WorkPhotoStage` — stage (before/during/after).
- `ReportRecord` — kind, start_date, end_date, status, title, narrative,
  snapshot_json, created_by, created_at.
- `ReminderDelivery` — absence_request_id, reminder_days, recipient, status,
  message, created_at, sent_at. **Unique (absence_request_id, reminder_days).**

## 2. Roles

`system_admin`, `ward_officer`, `subcounty_reviewer`, `hr_viewer`, `read_only`.

## 3. Permission scopes (feature areas)

`attendance`, `staff_register`, `work_logs`, `absences`, `reports`, `audit`.

- `system_admin` bypasses scope checks (`has_scope` returns `True`).
- `read_only` (approved public applicants) receives a CSV permission list and
  cannot export reports, create users, or mutate operational records.
- A user with **empty** `permissions` has access to **all** scopes
  (see fail-open note below).

## 4. Authentication & sessions

- scrypt password hashing with per-user random salt (`scrypt$salt$digest`).
- Server-side sessions: random `token_urlsafe(32)`, only its SHA-256 stored.
- Session cookie: httponly, samesite=lax, `secure` when `SECURE_COOKIES=true`,
  max-age `SESSION_HOURS` (default 12).
- Per-session CSRF token; privileged POSTs verify it.
- Logout revokes the session; account disable revokes all active sessions.
- `must_change_password` flag; password/email/name change under `/account`.
- Owner bootstrap: dev seeds a `system_admin`; `/setup` + one-time
  `OWNER_SETUP_TOKEN` replaces it once; `owner_setup_completed` audit event
  permanently closes setup.
- Public self-registration (`/register`) creates a pending `AccessRequest`.

## 5. Attendance workflow

- Officer creates a daily session (activity, location, duration ∈
  {30, 60, 120, 240, 480} min). Only one active session per day.
- QR encodes `${PUBLIC_BASE_URL}/check-in/{token}`.
- Check-in: employee enters 11-digit Employee ID (not phone).
- Late if `checked_at > opens_at + 30 min`, else present.
- Optional GPS captured (lat/lon validated to ranges).
- Duplicate check-in blocked by DB unique constraint.
- Rate limiting: 15 attempts / 10 min per (client IP, session token).
- Supervised/manual status only for staff with no check-in record:
  present / absent / off_duty / sick_off, with reason.
- Roster derivation precedence: checked present/late → approved absence
  (sick_off / official_duty / leave) → manual record → roster annual_leave →
  absent.

## 6. Absence / leave

- `kind` ∈ annual_leave, maternity_leave, paternity_leave,
  compassionate_leave, sick_off, official_duty, unpaid_leave.
- Date validation: end ≥ start, return > end.
- Overlap prevention for statuses in {submitted, approved}.
- sick_off requires reason ≥ 10 chars.
- status transitions (string): planned/submitted → approve/reject/submit/cancel.
- Rejection requires a note (≥ 3 chars).
- Supporting documents (PDF/JPG/PNG, signature-verified) categorized.
- Medical-document download restricted to hr_viewer / system_admin.

## 7. Work logs

- Date, activity, location, areas_roads, description, number_of_trips,
  waste_transfer_involved, truck_id (`T-\d+`), backhoe_id (`BH\d+`),
  staff_count, challenges, cleanup_done, cleanup_stakeholders,
  climate_team_count, completion_status, outstanding_work.
- Business rules:
  - waste transfer ⇒ trips ≥ 1 and truck/backhoe present.
  - cleanup ⇒ stakeholders or climate_team_count > 0.
  - incomplete ⇒ outstanding_work ≥ 5 chars.
  - ≤ 4 photos each for before/during/after.
- status: submitted → approve/reject (rejection needs note ≥ 3 chars).
- Photo files signature-verified (JPG/PNG), sha256 recorded, integrity checked
  on read.

## 8. Reporting

- Periods: daily, weekly, monthly, custom; range 1..366 days.
- Snapshot: attendance totals by status, per-day roster, approved work logs,
  sampled photos.
- Daily reports include all photos; weekly/monthly sample ≤ 4 per stage.
- Deterministic narrative + recommendations (no-AI fallback).
- Optional Groq AI narrative from a minimized payload (no names, IDs, phones,
  free-text, medical, challenges).
- Finalize ⇒ immutable `snapshot_json` + narrative + recommendations +
  signature (finalizer name + role/title) + generation time.
- CSV export with formula-injection escaping; blocked for read_only.
- Print/PDF via browser.

## 9. Notifications

- Leave reminders at 30 / 14 / 7 days before start.
- Idempotent per (absence_request_id, reminder_days).
- Delivery statuses: queued / processing / sent / failed.
- Hourly loop + startup run; SMTP optional.

## 10. Audit events (actions observed)

`owner_setup_completed`, `login_succeeded`, `login_failed`, `logout`,
`access_requested`, `access_request_approved`, `access_request_rejected`,
`attendance_session_created`, `attendance_checked_in`, `checkin_failed`,
`attendance_manual_exception`, `employee_created`, `employee_updated`,
`employee_deactivated`, `employee_reactivated`, `employees_imported`,
`absence_created`, `absence_approved/rejected/submitted/cancelled`,
`absence_document_downloaded`, `work_log_submitted`, `work_log_approved`,
`work_log_rejected`, `report_finalized`, `report_csv_exported`,
`report_narrative_drafted`, `leave_reminders_processed`, `user_created`,
`user_access_revoked`, `user_access_restored`, `account_updated`,
`password_changed`.

## 11. Tests (existing coverage)

Health/anonymous boundary, Railway DB URL normalization, AI payload privacy,
weekly/monthly photo sampling, owner bootstrap replacement, read-only signup
+ scope approval + revocation, CSRF requirement, verified check-in + duplicate
prevention, invalid employee ID, manual exception only for non-checked staff,
approved sick-off replaces manual absence, manual sick-off, approved leave
reconciles roster, work-log final report + CSV stability, work-log equipment/
cleanup/photo rules, admin user creation + Excel import, medical document
privacy + reminder idempotency.

## 12. Classification

### PRESERVE

- Employee number format (11 digits, year-prefixed) and validation.
- Kenyan phone normalization/validation.
- Attendance unique invariant `(employee, work_date)`.
- Expiring, server-generated, unguessable QR session tokens.
- QR check-in using Employee ID (not phone).
- Late threshold (30 min) and statuses (present/late/absent/off_duty/leave/
  sick_off/official_duty).
- Supervised/manual exceptions only for staff without a check-in.
- Roster derivation precedence.
- Absence kind set and date rules; overlap prevention; sick-off reason rule.
- Work-log equipment/cleanup/completion/photo business rules.
- Before/during/after photo stages (≤ 4 each).
- Report immutability via snapshot; deterministic aggregation; AI optional with
  minimized payload; CSV escaping; read_only export block.
- Reminder offsets (30/14/7) and idempotency.
- File-signature validation (PDF/JPG/PNG) + sha256 integrity checks.
- Security headers, secure cookies, CSRF, session revocation, login
  throttling.
- Nairobi timezone for operational dates.
- Audit event coverage of the above.

### IMPROVE

- Scope authorization: `has_scope` treats empty permissions as full access
  (fail-open). Replace with centralized, default-**DENY** capability checks
  (§12 of the spec).
- Role checks are scattered per-route. Centralize into guards/policies.
- Absence legacy dual-model (`Absence` + `PlannedLeave` + `AbsenceRequest`).
  Consolidate into one `AbsenceRequest` with explicit transitions (§18).
- Manual "migrations" (`COLUMN_MIGRATIONS` ALTER statements). Use Prisma
  migrations.
- `Base.metadata.create_all` on boot. Use reproducible migrations.
- Files stored on container filesystem. Move to private S3-compatible storage
  with metadata in PostgreSQL (§5).
- Report aggregation duplicated per level. Build reusable deterministic
  aggregation (§26).

### REPLACE

- Flask-style server-rendered FastAPI/Jinja2 → Next.js (presentation) +
  NestJS/Fastify (API). Do not translate Python file-by-file.
- SQLAlchemy + SQLite → PostgreSQL + Prisma.
- `User.role` as sole authorization → `User` + `Assignment(role, scopeType,
  scopeId)` + central capability model.
- Hard-coded "Makina" → organisational hierarchy (County → Subcounty → Ward)
  where Makina is data.
- CSV `permissions` column → role/capability tables.
- Jinja2 templates → React components.
- `qrcode` Python lib → JS QR generation (or server-rendered).

### REMOVE

- Legacy `Absence` and `PlannedLeave` tables (superseded by unified model).
- `WorkLog.quantity`/`unit` legacy output fields (superseded by
  `WorkLogOperations`).
- Fail-open empty-permissions behavior.
- SQLite production path.
- Manual `ALTER TABLE` migration hacks.
- Ephemeral container-filesystem document storage.
- Placeholder "NCC" text seal (replaced by the approved
  `nairobi-city-county-logo.png`).

## 13. Known weaknesses not to reproduce

- Fail-open scope (empty permissions ⇒ full access).
- Tenant/scope data not modeled: everything is implicitly "Makina" single ward.
- No tenant isolation at all (single-ward assumption).
- Filesystem uploads can orphan DB metadata or vice-versa on partial failure.
- String-based status mutation (no explicit transition enforcement beyond
  route checks).
- `create_all` + ad-hoc ALTER migrations (no migration history).
- Authorization/role logic scattered across routes.
