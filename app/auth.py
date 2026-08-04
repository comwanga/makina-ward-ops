import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User, UserSession
from .services import now


COOKIE_NAME = "makina_session"

SCOPES = {
    "attendance": "Attendance register",
    "staff_register": "Staff register",
    "work_logs": "Daily work logs",
    "absences": "Leave and sick-off",
    "reports": "Reports and archive",
    "audit": "Audit history",
}


def has_scope(user: User, scope: str) -> bool:
    if user.role == "system_admin":
        return True
    if not user.permissions:
        return True
    return scope in {part.strip() for part in user.permissions.split(",")}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, expected = stored.split("$", 2)
        actual = hash_password(password, bytes.fromhex(salt_hex)).split("$", 2)[2]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class AuthContext:
    user: User
    session: UserSession


def create_session(db: Session, user: User) -> tuple[str, UserSession]:
    raw = secrets.token_urlsafe(32)
    current = now()
    session = UserSession(
        user_id=user.id,
        token_hash=token_hash(raw),
        csrf_token=secrets.token_urlsafe(24),
        created_at=current,
        last_seen_at=current,
        expires_at=current + timedelta(hours=settings.session_hours),
    )
    db.add(session)
    db.commit()
    return raw, session


def optional_user(request: Request, db: Session = Depends(get_db)) -> AuthContext | None:
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(raw)))
    if not session or session.revoked_at or session.expires_at <= now() or not session.user.active:
        return None
    session.last_seen_at = now()
    db.commit()
    return AuthContext(session.user, session)


def require_user(auth: AuthContext | None = Depends(optional_user)) -> AuthContext:
    if not auth:
        raise HTTPException(401, "Authentication required")
    return auth


def require_roles(*roles: str):
    def dependency(auth: AuthContext = Depends(require_user)) -> AuthContext:
        if auth.user.role not in roles:
            raise HTTPException(403, "You do not have permission for this action")
        return auth
    return dependency


def verify_csrf(auth: AuthContext, submitted: str) -> None:
    if not submitted or not hmac.compare_digest(auth.session.csrf_token, submitted):
        raise HTTPException(403, "Invalid form security token")
