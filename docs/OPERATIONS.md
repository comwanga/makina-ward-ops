# Operations Guide

## Daily workflow

1. Sign in and generate the day's attendance QR with activity, location and closing time.
2. Display the QR at the work site. Use supervised check-in only when necessary and record the reason.
3. Review unaccounted staff. For staff who did not use the QR, record an audited supervised-present, confirmed-absent, or off-duty exception.
4. Record work completed, structured output quantities, staff count and challenges.
5. Mark work complete or incomplete and upload WhatsApp photos or take field photos directly.
6. Have an authorised reviewer approve requests and work logs.
7. Review the AI-assisted narrative and recommendations, then sign and archive the daily report.

## Weekly and monthly reports

Open Reports, choose the period and preview it. Reports include recommendations, field photos, the owner's full name, and generation date/time. Finalised reports are immutable archived snapshots for appraisal and future reference.

Use **Attendance history** to select any calendar date, review check-in times and statuses, generate that day's staff report, or reopen an already archived daily report.

## Staff roster

Upload the official Excel list under **Staff register**. The Employee ID must be 11 digits and start with the four-digit year, for example `20230464669`. Staff check in with the exact Employee ID saved in the register; phone numbers are not used for check-in verification. Existing IDs are updated. Correct typing errors with **Edit** and use **Deactivate** rather than deleting former staff. Imported annual leave affects the current daily tally until the record is changed back to on duty or a newer roster is uploaded.

## Scanned forms

Under **Leave & sick-off**, scan or upload sick sheets, medical certificates, leave forms, approvals and return-to-work forms. These files remain private to authorised HR/owner roles.

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
