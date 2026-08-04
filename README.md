# Makina Ward Operations

Makina Ward Operations is a mobile-first workforce attendance and environment reporting system for Makina Ward, Kibra Sub County. It combines QR attendance, staff records, leave and sick-off evidence, field work documentation, report generation, controlled AI assistance, and an appraisal-ready report archive.

> The `NCC` seal included in the interface is a placeholder. Replace it only with an officially approved Nairobi City County logo and branding asset.

## Main Features

### Staff and access management

- One-time system owner setup with a private Railway setup token.
- Owner-controlled access requests and approval or rejection.
- Read-only benchmark accounts that cannot change or export operational records.
- Roles for system owners, ward officers, Sub County reviewers, HR viewers, and read-only visitors.
- Staff creation, correction, deactivation, and reactivation without deleting historical records.
- Excel and CSV roster imports that update existing payroll IDs and add new staff.

### Attendance and leave

- Expiring daily QR attendance sessions.
- Employee verification using payroll/employee ID and registered phone details.
- Duplicate check-in prevention, late classification, and optional GPS capture.
- Supervised check-in for staff without suitable smartphones.
- Audited manual exceptions for staff who remain absent after QR check-in, including confirmed absent and off-duty status.
- Automatic present, absent, late, annual-leave, and sick-off tallies.
- Date-based attendance and check-in history with daily staff report generation for any day of the year.
- Planned leave schedules and 30-, 14-, and 7-day reminder processing.
- Approval and rejection workflows for leave and sick-off records.
- Private uploads for sick sheets, medical certificates, leave forms, approvals, and return-to-work forms.

### Field operations

- Daily work descriptions, locations, quantities, units, staff counts, and challenges.
- Separate complete and incomplete work status with outstanding-work notes.
- Upload saved or WhatsApp JPG/PNG photos.
- Take field photos directly from a supported phone.
- Up to eight private field photos per work log.
- Review and approval workflow before work appears in final reports.

### Reports and AI

- Daily, weekly, monthly, and custom reporting periods.
- Attendance details, approved work, completion status, field photos, and recommendations.
- Automatic report signature using the finaliser's account name and role.
- Automatic generation date and time.
- Immutable finalised reports retained in the report archive for appraisals and future reference.
- Print-to-PDF layout and Excel-compatible CSV export.
- Optional Groq AI narrative drafting using `llama-3.1-8b-instant`.
- Local deterministic report fallback when AI is disabled, unavailable, or rate-limited.

The AI payload excludes employee names, employee IDs, phone numbers, attendance rows, medical information, work descriptions, and challenge notes. AI output remains a draft and must be reviewed before finalisation.

## Staff Roster Format

Upload an `.xlsx` workbook or UTF-8 `.csv` containing these required fields:

```text
Names | Phone Numbers | Pay Roll Numbers | Status | Residence
```

Common heading variations are accepted. Payroll number becomes the Employee ID/User ID used during attendance verification.

Supported roster statuses:

```text
ON DUTY
ANNUAL LEAVE
```

Existing payroll IDs are updated and new IDs are added. Staff omitted from a later upload are not deleted automatically. Deactivate them from the staff register when necessary. Imported annual leave remains current until the record is changed back to on duty or a newer roster is uploaded.

## Technology

| Layer | Technology |
|---|---|
| Application | FastAPI, Python 3.12, Jinja2 |
| Data access | SQLAlchemy 2 |
| Production database | PostgreSQL with Psycopg 3 |
| Local database | SQLite |
| Excel import | OpenPyXL |
| AI | Groq OpenAI-compatible API, optional |
| Deployment | Docker and Railway |

## Local Development

Create an isolated environment and install development dependencies:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`.

Do not reuse development credentials in production. Supply your own local values when testing account setup:

```bash
export BOOTSTRAP_ADMIN_EMAIL="local-owner@example.test"
export BOOTSTRAP_ADMIN_PASSWORD="<choose-a-local-password>"
export OWNER_SETUP_TOKEN="<generate-a-separate-random-token>"
```

If Ubuntu does not provide `python3-venv`, dependencies can be installed into a local ignored directory:

```bash
python3 -m pip install --target .packages --break-system-packages -r requirements-dev.txt
PYTHONPATH=.packages python3 -m uvicorn app.main:app --reload
```

## Tests

```bash
PYTHONPATH=.packages python3 -m pytest -q
```

## Railway Deployment

The repository includes `railway.json` and a production `Dockerfile`. Railway should use the Dockerfile command; leave the Railway custom Start Command empty.

Required application variables:

```text
APP_ENV=production
DATABASE_URL=<reference the Railway PostgreSQL DATABASE_URL>
SECURE_COOKIES=true
OWNER_SETUP_TOKEN=<one-time random owner setup token>
DOCUMENT_ROOT=/app/data/documents
```

Railway provides `PORT` and `RAILWAY_PUBLIC_DOMAIN` automatically. Do not create them manually.

After the first owner setup:

1. Open `/setup` on the deployed domain.
2. Create the permanent owner account.
3. Remove `OWNER_SETUP_TOKEN` from Railway.
4. Redeploy the application.

Attach a persistent Railway volume to:

```text
/app/data/documents
```

Scanned forms and field photos will be lost during redeployment if this volume is not attached.

Optional SMTP variables:

```text
SMTP_HOST=<approved SMTP host>
SMTP_PORT=587
SMTP_USERNAME=<SMTP username>
SMTP_PASSWORD=<SMTP password>
SMTP_FROM=<approved sender address>
```

Optional Groq AI variables:

```text
AI_ENABLED=true
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=<Groq API key>
AI_MODEL=llama-3.1-8b-instant
```

Enter Railway values without quotation marks. Never place actual passwords, database URLs, setup tokens, SMTP credentials, or API keys in GitHub.

See [Railway deployment instructions](docs/RAILWAY.md) for the complete setup.

## Security and Privacy

- Server-side sessions, secure cookies, CSRF protection, and role checks protect administrative actions.
- QR check-in verification attempts are rate-limited.
- Sensitive uploads are stored outside public static files.
- Medical files are restricted to authorised HR and owner roles.
- Operational changes, approvals, downloads, exports, and access decisions are audited.
- Finalised report snapshots are retained independently of later source-record edits.
- Spreadsheet values are escaped during CSV exports to reduce formula-injection risk.

Before entering real personnel or medical data:

- Complete a Kenya Data Protection Act impact assessment.
- Approve data retention and deletion periods.
- Configure encrypted PostgreSQL and document-volume backups.
- Test database and file restoration.
- Add malware scanning or approved scanned private object storage.
- Confirm official branding, report templates, attendance rules, and approval authority.
- Use county SSO and MFA when they become available.

If a real credential has ever been committed or shared publicly, removing it from a file is not sufficient. Revoke and rotate it immediately.

## Health Checks

```text
GET /health/live
GET /health/ready
```

Readiness verifies database connectivity and writable private document storage.

## Documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Operations guide](docs/OPERATIONS.md)
- [Railway deployment](docs/RAILWAY.md)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
