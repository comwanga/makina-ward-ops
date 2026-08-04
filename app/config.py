import os
from dataclasses import dataclass
from pathlib import Path


def public_base_url() -> str:
    configured = os.getenv("PUBLIC_BASE_URL")
    if configured:
        return configured.rstrip("/")
    railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    if railway_domain:
        return f"https://{railway_domain}"
    return "http://127.0.0.1:8000"


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    public_base_url: str = public_base_url()
    secure_cookies: bool = os.getenv("SECURE_COOKIES", "false").lower() == "true"
    session_hours: int = int(os.getenv("SESSION_HOURS", "12"))
    bootstrap_email: str = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "officer@makina.local")
    bootstrap_password: str = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "ChangeMe123!")
    owner_setup_token: str | None = os.getenv("OWNER_SETUP_TOKEN")
    smtp_host: str | None = os.getenv("SMTP_HOST")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_username: str | None = os.getenv("SMTP_USERNAME")
    smtp_password: str | None = os.getenv("SMTP_PASSWORD")
    smtp_from: str = os.getenv("SMTP_FROM", "makina-ward@example.go.ke")
    ai_enabled: bool = os.getenv("AI_ENABLED", "false").lower() == "true"
    ai_base_url: str = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
    ai_api_key: str | None = os.getenv("AI_API_KEY")
    ai_model: str = os.getenv("AI_MODEL", "gpt-4o-mini")
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))
    document_root: Path = Path(os.getenv("DOCUMENT_ROOT", Path(__file__).resolve().parent.parent / "data" / "documents"))


settings = Settings()
