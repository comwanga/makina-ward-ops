# Railway Deployment

## Create the services

1. In Railway, create a project from the `comwanga/makina-ward-ops` GitHub repository.
2. Select `main` as the production branch and enable automatic deployments.
3. Add a PostgreSQL service to the same Railway project.
4. In the application service, add the variables listed below.
5. Generate a public domain under the application service Networking settings.
6. Add a persistent volume mounted at `/app/data/documents` before accepting medical uploads.

Railway reads `railway.json`, builds the included `Dockerfile`, starts one application replica on `$PORT`, and checks `/health/ready` before considering a deployment healthy.

## Required variables

```text
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SECURE_COOKIES=true
BOOTSTRAP_ADMIN_EMAIL=<your officer email>
BOOTSTRAP_ADMIN_PASSWORD=<a unique random password of at least 20 characters>
DOCUMENT_ROOT=/app/data/documents
```

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

## Optional AI variables

Keep AI disabled until the provider and data-processing terms are approved.

```text
AI_ENABLED=false
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=<provider key>
AI_MODEL=gpt-4o-mini
```

## First deployment checks

1. Open `/health/ready` on the generated domain and confirm `{"status":"ready"}`.
2. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
3. Change the bootstrap password immediately.
4. Generate an attendance QR and verify that its link uses the Railway or custom HTTPS domain.
5. Upload and download a synthetic medical document, redeploy, and confirm the file remains available from the mounted volume.
6. Configure Railway PostgreSQL backups before entering real staff data.

Do not use SQLite in Railway production. The application container filesystem is ephemeral outside the mounted document volume.
