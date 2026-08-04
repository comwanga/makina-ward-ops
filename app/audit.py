from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditEvent
from .services import now


def record_audit(
    db: Session,
    request: Request,
    action: str,
    target_type: str,
    target_id: int | str | None = None,
    actor_user_id: int | None = None,
    details: str | None = None,
) -> None:
    db.add(
        AuditEvent(
            occurred_at=now(),
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            details=details,
            source_ip=request.client.host if request.client else None,
        )
    )
