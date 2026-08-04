import smtplib
from datetime import timedelta
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .models import AbsenceRequest, ReminderDelivery
from .services import now, today


def send_email(recipient: str, subject: str, body: str) -> tuple[str, str | None]:
    if not settings.smtp_host:
        return "queued", "SMTP is not configured; reminder retained for delivery"
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
            client.starttls()
            if settings.smtp_username:
                client.login(settings.smtp_username, settings.smtp_password or "")
            client.send_message(message)
        return "sent", None
    except (OSError, smtplib.SMTPException) as exc:
        return "failed", str(exc)[:300]


def process_leave_reminders(db: Session) -> int:
    processed = 0
    requests = db.scalars(
        select(AbsenceRequest).where(
            AbsenceRequest.kind != "sick_off",
            AbsenceRequest.status.in_(("planned", "submitted", "approved")),
            AbsenceRequest.start_date >= today(),
            AbsenceRequest.start_date <= today() + timedelta(days=30),
        )
    ).all()
    for item in requests:
        days = (item.start_date - today()).days
        if days not in (30, 14, 7):
            continue
        recipient = item.employee.email
        if not recipient:
            continue
        delivery = ReminderDelivery(
            absence_request_id=item.id,
            reminder_days=days,
            recipient=recipient,
            status="processing",
            created_at=now(),
        )
        db.add(delivery)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        status, error = send_email(
            recipient,
            f"Leave application reminder: {item.start_date:%d %B %Y}",
            f"Dear {item.employee.full_name},\n\nYour planned leave begins in {days} days. Please submit or confirm your leave application in good time.\n\nMakina Ward Environment Office",
        )
        delivery.status = status
        delivery.message = error
        delivery.sent_at = now() if status == "sent" else None
        db.commit()
        processed += 1
    return processed
