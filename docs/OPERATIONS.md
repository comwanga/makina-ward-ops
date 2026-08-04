# Operations Guide

## Daily workflow

1. Sign in and generate the day's attendance QR with activity, location and closing time.
2. Display the QR at the work site. Use supervised check-in only when necessary and record the reason.
3. Review unaccounted staff and submitted leave/sick-off requests.
4. Record work completed, structured output quantities, staff count and challenges.
5. Have an authorised reviewer approve requests and work logs.
6. Preview and finalise the daily report. Print to PDF or download CSV as required.

## Weekly and monthly reports

Open Reports, choose the period and preview it. Draft reports can be regenerated; finalised reports are immutable snapshots. Correct source data first and create a new report if a previously finalised report must be superseded.

## Leave reminders

The application checks reminders at startup and hourly. It creates at most one delivery per request and reminder offset. Without SMTP configuration, reminders remain marked `queued`; no email is falsely reported as sent.

## Backup

- Back up PostgreSQL daily using the hosting provider's encrypted backup facility or `pg_dump`.
- Back up the private document volume on the same retention schedule.
- Keep database and document backups aligned because document metadata is stored in PostgreSQL.
- Perform a restore test before pilot launch and at least quarterly.

## Incident response

1. Disable public access or stop the web service if confidential data may be exposed.
2. Preserve application, reverse-proxy and audit logs.
3. Revoke affected user sessions by changing account credentials; rotate database, SMTP and AI keys where relevant.
4. Determine affected people, records and dates.
5. Follow Nairobi City County and Office of the Data Protection Commissioner notification procedures.
6. Document remediation before restoring service.

## Monitoring

- `/health/live` checks the web process.
- `/health/ready` checks database connectivity and document storage.
- Alert on repeated readiness failures, HTTP 500 rates, low disk space, failed email deliveries and backup failures.
- Do not place phone numbers, medical reasons, tokens or document contents in logs.
