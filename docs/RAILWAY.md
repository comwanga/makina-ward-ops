# Railway Deployment

## Create the services

1. In Railway, create a project from the `comwanga/makina-ward-ops` GitHub repository.
2. Select `main` as the production branch and enable automatic deployments.
3. Add a PostgreSQL service to the same Railway project.
4. In the application service, add the variables listed below.
5. Generate a public domain under the application service Networking settings.
6. Add a persistent volume mounted at `/app/data/documents` before accepting medical uploads.

Railway reads `railway.json`, builds the included `Dockerfile`, starts one application replica on its assigned `PORT`, and checks `/health/ready` before considering a deployment healthy. Leave the Railway service's custom Start Command empty so the tested Dockerfile command is used.

## Required variables

```text
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SECURE_COOKIES=true
BOOTSTRAP_ADMIN_EMAIL=<your officer email>
BOOTSTRAP_ADMIN_PASSWORD=<a unique random password of at least 20 characters>
OWNER_SETUP_TOKEN=<a separate random one-time token of at least 32 characters>
DOCUMENT_ROOT=/app/data/documents
```

After deployment, open `/setup`, enter `OWNER_SETUP_TOKEN`, and create your permanent owner name, email and password. You are signed in automatically. Remove `OWNER_SETUP_TOKEN` from Railway after setup and redeploy. Existing installations can instead sign in once with the bootstrap account and change their email, name and password under **My account**.

Visitors use `/register` to request benchmark access. They cannot sign in until the owner approves them under **User access**. Approved applicants receive the fixed `read_only` role and cannot perform officer or administrator changes.

Railway supplies `RAILWAY_PUBLIC_DOMAIN` after a public domain is generated. The application automatically uses it for QR check-in links. `PUBLIC_BASE_URL` is only required when using a custom domain:

```text
PUBLIC_BASE_URL=https://your-approved-domain.example.go.ke
```

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

## First deployment checks

1. Open `/health/ready` on the generated domain and confirm `{"status":"ready"}`.
2. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
3. Change the bootstrap password immediately.
4. Generate an attendance QR and verify that its link uses the Railway or custom HTTPS domain.
5. Upload and download a synthetic medical document, redeploy, and confirm the file remains available from the mounted volume.
6. Configure Railway PostgreSQL backups before entering real staff data.

Do not use SQLite in Railway production. The application container filesystem is ephemeral outside the mounted document volume.
