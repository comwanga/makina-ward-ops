# Makina Ward Operations

A complete mobile-first staff attendance, leave, field-work and reporting application for Makina Ward, Kibra Sub County.

## Capabilities

- Secure officer login with server-side sessions, CSRF protection, role checks and password rotation.
- Roles for Ward Officers, Sub County Reviewers, HR Viewers and System Administrators.
- Official staff register, individual entry and validated CSV import.
- Expiring QR attendance, employee/phone verification, rate limiting, duplicate prevention and optional GPS.
- Supervised check-in fallback for employees without suitable phones.
- Planned leave, sick-off evidence, approval/rejection, return dates and overlap prevention.
- Automated 30-, 14- and 7-day email reminder processing with idempotent delivery records.
- Daily work logs with locations, quantities, units, staff counts, challenges and approval.
- Daily, weekly, monthly and custom report periods.
- Optional AI-assisted report narrative with deterministic fallback and no medical/contact data sent.
- Immutable finalised report snapshots, print/PDF layout and Excel-compatible CSV export.
- Private medical-document downloads restricted to HR and system administrators.
- Append-only operational audit history.
- SQLite for local evaluation and PostgreSQL/Docker deployment support.
- Responsive installable web application manifest.

The `NCC` seal is a placeholder. Replace it only after receiving an approved Nairobi City County logo asset and written branding approval.

## Local setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload
```

If Ubuntu's `python3-venv` package is unavailable:

```bash
python3 -m pip install --target .packages --break-system-packages -r requirements-dev.txt
PYTHONPATH=.packages python3 -m uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`.

Development login:

```text
Email: officer@makina.local
Password: ChangeMe123!
```

The application requires that password to be changed after login. Production refuses to start with the development password.

## Tests

```bash
PYTHONPATH=.packages python3 -m pytest -q
```

## Production with Docker

1. Copy `.env.example` to `.env` and replace every credential and public URL.
2. Set a separate strong `POSTGRES_PASSWORD` in `.env`.
3. Configure approved SMTP details if email reminders will be sent.
4. Keep `AI_ENABLED=false` until the Groq free-tier setup and data-processing terms are approved.
5. Run `docker compose up --build -d`.
6. Confirm `/health/ready` returns `{"status":"ready"}` through HTTPS.
7. Sign in with the bootstrap administrator and immediately change its password.

Only one web process should run the built-in reminder scheduler. If the service is scaled horizontally, move reminder processing to a dedicated worker or add a database scheduler lock.

## Excel staff import

Upload the initial roster as `.xlsx` or UTF-8 `.csv` using these required columns:

```text
Names | Phone Numbers | Pay Roll Numbers | Status | Residence
```

Payroll number becomes the Employee ID/User ID. Supported statuses are `ON DUTY` and `ANNUAL LEAVE`. Existing payroll IDs are updated and new IDs are added. Omitted staff are not deleted automatically; deactivate them in the staff register. Import is transactional: any invalid row rejects the complete upload.

## Production approval gates

Before entering real employee or medical data:

- Complete a Kenya Data Protection Act impact assessment and approve retention periods.
- Put the service behind managed HTTPS and restrict network/database access.
- Arrange encrypted PostgreSQL and document-volume backups and test restoration.
- Install malware scanning or use approved private object storage with scanning for uploaded files.
- Configure county SSO/MFA if available; local passwords are the deployable fallback.
- Confirm official report templates, logo use, attendance hours and approval authority.
- Run a synthetic-data pilot and then a limited consented staff pilot.

See `docs/IMPLEMENTATION_PLAN.md` and `docs/OPERATIONS.md`.

Railway-specific setup and environment variables are documented in `docs/RAILWAY.md`.
