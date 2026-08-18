# Railway Deployment

## Create the services

1. In Railway, create a project from the `comwanga/makina-ward-ops` GitHub repository.
2. Select `main` as the production branch and enable automatic deployments.
3. Create three services:
   - **api**: connects to the repository. `railway.json` builds `infrastructure/Dockerfile.api`, starts one replica on its assigned `PORT`, and checks `/health/ready` before considering the deployment healthy. Leave the custom Start Command empty.
   - **web**: connects to the repository. In the service's Deploy settings set the Dockerfile path to `infrastructure/Dockerfile.web`, and pass `NEXT_PUBLIC_API_URL` as a **build variable** equal to your public API domain (see below) — it is inlined into the browser bundle at build time.
   - **PostgreSQL**: add a Postgres service to the same Railway project.
4. Add the variables listed below to the api service.
5. Generate a public domain under the api service Networking settings, and a second public domain for the web service.
6. (Optional) Add an object-storage service such as S3-compatible storage and wire the `S3_*` variables below. Production refuses to start without S3 configuration so evidence is never silently written to the ephemeral container filesystem.

## Required variables (api service)

```text
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SECURE_COOKIES=true
S3_BUCKET=<your S3 bucket>
S3_ACCESS_KEY_ID=<your S3 access key id>
S3_SECRET_ACCESS_KEY=<your S3 secret access key>
S3_REGION=<your bucket region>
BOOTSTRAP_ADMIN_EMAIL=<your officer email>
BOOTSTRAP_ADMIN_PASSWORD=<a unique random password of at least 20 characters>
OWNER_SETUP_TOKEN=<a separate random one-time token of at least 32 characters>
```

Railway supplies `RAILWAY_PUBLIC_DOMAIN` after a public domain is generated for the api service. The API automatically uses it for QR check-in links. `PUBLIC_BASE_URL` is only required when using a custom domain:

```text
PUBLIC_BASE_URL=https://your-approved-domain.example.go.ke
```

For the web service set the build variable `NEXT_PUBLIC_API_URL` to the API base URL, e.g. `https://<api-railway-domain>/api/v1`. The default (`http://localhost:4000/api/v1`) is only correct for local development.

## First-time setup

After deployment, open `/setup` on the web domain, enter `OWNER_SETUP_TOKEN`, and create your permanent owner name, email and password. You are signed in automatically. Remove `OWNER_SETUP_TOKEN` from Railway after setup and redeploy. Existing installations can instead sign in once with the bootstrap account and change their email, name and password under **My account**.

Visitors use `/register` to request benchmark access. They cannot sign in until the owner approves them under **User access**. Approved applicants receive the fixed `read_only` role and cannot perform officer or administrator changes.

## Optional email variables

Leave reminders remain safely queued when SMTP is not configured.

```text
SMTP_HOST=<approved SMTP host>
SMTP_PORT=587
SMTP_USERNAME=<SMTP username>
SMTP_PASSWORD=<SMTP password>
SMTP_FROM=<approved sender address>
```

## Free Groq AI variables

Groq offers a rate-limited free plan suitable for light report drafting. Create an account at `https://console.groq.com`, open **API Keys**, and create a new key. Add the key only in Railway; never put it in GitHub or application source code.

```text
AI_ENABLED=true
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=<your Groq API key>
AI_MODEL=llama-3.1-8b-instant
```

The integration sends only the reporting period, attendance totals, and structured approved work facts: date, activity, location, quantity, unit and staff count. It excludes employee names, IDs, phone numbers, attendance rows, medical data, free-text descriptions and challenges. AI output is always a draft and must be reviewed before finalisation. If Groq is unavailable or a free-tier limit is reached, the application automatically produces its local non-AI narrative instead.

## Backup and object-storage lifecycle

- Configure Railway PostgreSQL backups before entering real staff data, or run `pnpm backup` on a schedule (see `docs/OPERATIONS.md`).
- Evidence objects live in the S3 bucket, not on the container filesystem. The database references them by key, so database and object-store backups must stay aligned.
- For S3, enable server-side encryption and a lifecycle rule that moves objects older than 365 days to a cost-optimised storage class. Do not expire objects automatically.
- Run the synthetic recovery drill quarterly: `DATABASE_URL=<scratch-db-url> pnpm recovery-drill` (see `docs/OPERATIONS.md`).

## First deployment checks

1. Open `/health/ready` on the api domain and confirm `{"status":"ready"}`.
2. Open the web domain and confirm it loads and reaches the API (sign-in page renders and login works).
3. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
4. Change the bootstrap password immediately.
5. Generate an attendance QR and verify that its link uses the Railway or custom HTTPS domain.
6. Upload and download a synthetic medical document, redeploy, and confirm the file remains available from S3.