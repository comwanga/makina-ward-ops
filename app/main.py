import csv
import asyncio
import hashlib
import io
import json
import re
import secrets
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

import qrcode
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .audit import record_audit
from .auth import COOKIE_NAME, AuthContext, create_session as create_user_session, hash_password, optional_user, require_roles, require_user, verify_csrf, verify_password
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import AbsenceRequest, Attendance, AttendanceSession, AuditEvent, Document, Employee, ReminderDelivery, ReportRecord, User, UserSession, WorkLog
from .notifications import process_leave_reminders
from .reporting import ai_narrative, build_snapshot, deterministic_narrative
from .services import dashboard_data, now, today


ROOT = Path(__file__).resolve().parent.parent
settings.document_root.mkdir(parents=True, exist_ok=True, mode=0o700)
templates = Jinja2Templates(directory=ROOT / "templates")
CHECKIN_ATTEMPTS: dict[str, tuple[int, object]] = {}


def initialize_database() -> None:
    if settings.app_env == "production" and settings.bootstrap_password == "ChangeMe123!":
        raise RuntimeError("BOOTSTRAP_ADMIN_PASSWORD must be changed in production")
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)) is None:
            db.add(
                User(
                    email=settings.bootstrap_email.lower(),
                    display_name="Makina Ward Officer",
                    password_hash=hash_password(settings.bootstrap_password),
                    role="system_admin",
                    must_change_password=True,
                    created_at=now(),
                )
            )
        if settings.app_env == "development" and db.scalar(select(Employee.id).limit(1)) is None:
            db.add_all(
                [
                    Employee(employee_number="NCC-1042", full_name="Amina Wanjiku", phone="0712345601", email="amina@example.go.ke", role="Team Leader"),
                    Employee(employee_number="NCC-1187", full_name="Brian Ochieng", phone="0712345602", email="brian@example.go.ke"),
                    Employee(employee_number="NCC-1234", full_name="Faith Njeri", phone="0712345603", email="faith@example.go.ke"),
                    Employee(employee_number="NCC-1298", full_name="Hassan Ali", phone="0712345604", email="hassan@example.go.ke"),
                    Employee(employee_number="NCC-1351", full_name="Mercy Atieno", phone="0712345605", email="mercy@example.go.ke"),
                    Employee(employee_number="NCC-1410", full_name="Peter Kamau", phone="0712345606", email="peter@example.go.ke"),
                ]
            )
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    with SessionLocal() as db:
        process_leave_reminders(db)
    async def reminder_loop():
        while True:
            await asyncio.sleep(3600)
            with SessionLocal() as db:
                process_leave_reminders(db)
    task = asyncio.create_task(reminder_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Makina Ward Operations", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'"
    return response


def redirect_login() -> RedirectResponse:
    return RedirectResponse("/login", status_code=303)


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, auth: AuthContext | None = Depends(optional_user)):
    if auth:
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(request=request, name="login.html", context={"error": None})


@app.post("/login", response_class=HTMLResponse)
def login(request: Request, email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == email.strip().lower(), User.active.is_(True)))
    if not user or not verify_password(password, user.password_hash):
        record_audit(db, request, "login_failed", "user", details="Invalid credentials")
        db.commit()
        return templates.TemplateResponse(request=request, name="login.html", context={"error": "Incorrect email or password"}, status_code=401)
    raw, _ = create_user_session(db, user)
    record_audit(db, request, "login_succeeded", "user", user.id, user.id)
    db.commit()
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE_NAME, raw, httponly=True, secure=settings.secure_cookies, samesite="lax", max_age=settings.session_hours * 3600)
    return response


@app.post("/logout")
def logout(request: Request, csrf_token: str = Form(...), auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    verify_csrf(auth, csrf_token)
    auth.session.revoked_at = now()
    record_audit(db, request, "logout", "user", auth.user.id, auth.user.id)
    db.commit()
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE_NAME)
    return response


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    data = dashboard_data(db, today())
    session = db.scalar(select(AttendanceSession).where(AttendanceSession.work_date == today()).order_by(AttendanceSession.created_at.desc()))
    employees = db.scalars(select(Employee).where(Employee.active.is_(True)).order_by(Employee.full_name)).all()
    requests = db.scalars(select(AbsenceRequest).order_by(AbsenceRequest.created_at.desc()).limit(6)).all()
    work_logs = db.scalars(select(WorkLog).order_by(WorkLog.work_date.desc(), WorkLog.id.desc()).limit(5)).all()
    deliveries = db.scalars(select(ReminderDelivery).order_by(ReminderDelivery.created_at.desc()).limit(5)).all()
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={**data, "session": session, "employees": employees, "now": now(), "auth": auth, "csrf": auth.session.csrf_token, "requests": requests, "work_logs": work_logs, "deliveries": deliveries},
    )


@app.post("/sessions")
def create_attendance_session(
    request: Request,
    activity: str = Form(...), location: str = Form(...), duration: int = Form(120), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if not activity.strip() or not location.strip() or duration not in (30, 60, 120, 240, 480):
        raise HTTPException(400, "Valid activity, location and duration are required")
    active = db.scalar(select(AttendanceSession).where(AttendanceSession.work_date == today(), AttendanceSession.closes_at > now()))
    if active:
        raise HTTPException(409, "An attendance session is already active today")
    opened = now()
    item = AttendanceSession(token=secrets.token_urlsafe(24), work_date=opened.date(), activity=activity.strip()[:160], location=location.strip()[:160], opens_at=opened, closes_at=opened + timedelta(minutes=duration), created_at=opened)
    db.add(item)
    db.flush()
    record_audit(db, request, "attendance_session_created", "attendance_session", item.id, auth.user.id, f"Closes {item.closes_at.isoformat()}")
    db.commit()
    return RedirectResponse("/#attendance", status_code=303)


@app.get("/sessions/{token}/qr.png")
def session_qr(token: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    item = db.scalar(select(AttendanceSession).where(AttendanceSession.token == token))
    if not item:
        raise HTTPException(404, "Attendance session not found")
    image = qrcode.make(f"{settings.public_base_url.rstrip('/')}/check-in/{token}")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return Response(buffer.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/check-in/{token}", response_class=HTMLResponse, name="checkin_page")
def checkin_page(token: str, request: Request, db: Session = Depends(get_db)):
    item = db.scalar(select(AttendanceSession).where(AttendanceSession.token == token))
    if not item:
        raise HTTPException(404, "Attendance session not found")
    public_csrf = secrets.token_urlsafe(24)
    response = templates.TemplateResponse(request=request, name="checkin.html", context={"session": item, "expired": not (item.opens_at <= now() <= item.closes_at), "message": None, "public_csrf": public_csrf})
    response.set_cookie("checkin_csrf", public_csrf, httponly=True, secure=settings.secure_cookies, samesite="strict", max_age=1800)
    return response


@app.post("/check-in/{token}", response_class=HTMLResponse)
def submit_checkin(
    token: str, request: Request, employee_number: str = Form(...), phone_last_four: str = Form(...), public_csrf: str = Form(...),
    latitude: float | None = Form(None), longitude: float | None = Form(None), db: Session = Depends(get_db),
):
    item = db.scalar(select(AttendanceSession).where(AttendanceSession.token == token))
    success = False
    if not secrets.compare_digest(request.cookies.get("checkin_csrf", ""), public_csrf):
        raise HTTPException(403, "Invalid form security token")
    key = f"{request.client.host if request.client else 'unknown'}:{token}"
    count, started = CHECKIN_ATTEMPTS.get(key, (0, now()))
    if (now() - started).total_seconds() > 600:
        count, started = 0, now()
    if count >= 15:
        raise HTTPException(429, "Too many attempts. Ask your supervisor for assistance")
    if not item or not (item.opens_at <= now() <= item.closes_at):
        message = "This attendance session is not open. Please contact your supervisor."
    elif not re.fullmatch(r"\d{4}", phone_last_four.strip()):
        message = "Enter exactly the last four digits of your registered phone number."
    elif latitude is not None and not -90 <= latitude <= 90 or longitude is not None and not -180 <= longitude <= 180:
        message = "The location supplied by the device is invalid."
    else:
        employee = db.scalar(select(Employee).where(Employee.employee_number == employee_number.strip().upper(), Employee.active.is_(True)))
        if not employee or not employee.phone.endswith(phone_last_four.strip()):
            CHECKIN_ATTEMPTS[key] = (count + 1, started)
            record_audit(db, request, "checkin_failed", "attendance_session", item.id, details="Employee verification failed")
            db.commit()
            message = "The employee number and phone digits do not match the official staff register."
        else:
            status = "late" if now() > item.opens_at + timedelta(minutes=30) else "present"
            db.add(Attendance(employee_id=employee.id, session_id=item.id, work_date=item.work_date, checked_at=now(), status=status, latitude=latitude, longitude=longitude))
            try:
                db.flush()
                record_audit(db, request, "attendance_checked_in", "employee", employee.id, details=f"Status {status}")
                db.commit()
                message = f"Attendance confirmed for {employee.full_name}."
                success = True
            except IntegrityError:
                db.rollback()
                message = "Your attendance has already been recorded today."
    return templates.TemplateResponse(request=request, name="checkin.html", context={"session": item, "expired": not item or not (item.opens_at <= now() <= item.closes_at), "message": message, "success": success, "public_csrf": public_csrf})


def normalized_phone(value: str) -> str:
    clean = re.sub(r"[^0-9+]", "", value)
    if not re.fullmatch(r"(?:\+254|0)\d{9}", clean):
        raise HTTPException(400, "Enter a valid Kenyan phone number")
    return clean


@app.post("/attendance/supervised")
def supervised_attendance(
    request: Request, employee_id: int = Form(...), reason: str = Form(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if len(reason.strip()) < 5:
        raise HTTPException(400, "A reason is required for supervised attendance")
    employee = db.get(Employee, employee_id)
    session = db.scalar(select(AttendanceSession).where(AttendanceSession.work_date == today()).order_by(AttendanceSession.created_at.desc()))
    if not employee or not employee.active or not session:
        raise HTTPException(404, "Employee or today's attendance session was not found")
    db.add(Attendance(employee_id=employee.id, session_id=session.id, work_date=today(), checked_at=now(), status="late" if now() > session.opens_at + timedelta(minutes=30) else "present"))
    try:
        db.flush()
        record_audit(db, request, "attendance_supervised", "employee", employee.id, auth.user.id, reason.strip())
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Attendance already exists for this employee today")
    return RedirectResponse("/#staff", status_code=303)


@app.post("/employees")
def add_employee(
    request: Request, employee_number: str = Form(...), full_name: str = Form(...), phone: str = Form(...), email: str | None = Form(None), role: str = Form("Green Army Staff"), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if len(full_name.strip()) < 3 or len(role.strip()) < 2:
        raise HTTPException(400, "Name and role are required")
    item = Employee(employee_number=employee_number.strip().upper()[:30], full_name=full_name.strip()[:120], phone=normalized_phone(phone), email=email.strip().lower() if email else None, role=role.strip()[:80])
    db.add(item)
    try:
        db.flush()
        record_audit(db, request, "employee_created", "employee", item.id, auth.user.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Employee number or phone already exists")
    return RedirectResponse("/#staff", status_code=303)


@app.post("/employees/import")
async def import_employees(
    request: Request, csv_file: UploadFile = File(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    content = await csv_file.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(400, "Employee CSV must be below 2 MB")
    try:
        rows = list(csv.DictReader(content.decode("utf-8-sig").splitlines()))
    except UnicodeDecodeError:
        raise HTTPException(400, "Employee CSV must use UTF-8 encoding")
    required = {"employee_number", "full_name", "phone", "role"}
    if not rows or not required.issubset(rows[0]):
        raise HTTPException(400, "CSV requires employee_number, full_name, phone and role headers")
    if len(rows) > 5000:
        raise HTTPException(400, "Employee CSV cannot exceed 5,000 rows")
    seen: set[str] = set()
    created = updated = 0
    for number, row in enumerate(rows, start=2):
        employee_number = row["employee_number"].strip().upper()
        if not employee_number or employee_number in seen or len(row["full_name"].strip()) < 3:
            raise HTTPException(400, f"Invalid or duplicate employee at CSV row {number}")
        seen.add(employee_number)
        phone = normalized_phone(row["phone"])
        employee = db.scalar(select(Employee).where(Employee.employee_number == employee_number))
        if employee:
            employee.full_name, employee.phone, employee.role = row["full_name"].strip()[:120], phone, row["role"].strip()[:80]
            employee.email = row.get("email", "").strip().lower() or None
            updated += 1
        else:
            db.add(Employee(employee_number=employee_number, full_name=row["full_name"].strip()[:120], phone=phone, email=row.get("email", "").strip().lower() or None, role=row["role"].strip()[:80]))
            created += 1
    record_audit(db, request, "employees_imported", "employee", actor_user_id=auth.user.id, details=f"{created} created, {updated} updated")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "CSV contains a phone or employee ID already assigned to another employee")
    return RedirectResponse("/#staff", status_code=303)


async def save_document(upload: UploadFile, absence_id: int, user_id: int) -> Document:
    original = Path(upload.filename or "document").name[:200]
    content = await upload.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(400, "Document exceeds the upload limit")
    signatures = {b"%PDF": "application/pdf", b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}
    content_type = next((mime for signature, mime in signatures.items() if content.startswith(signature)), None)
    if not content_type:
        raise HTTPException(400, "Document must be a genuine PDF, JPG or PNG file")
    key = secrets.token_hex(24)
    path = settings.document_root / key
    path.write_bytes(content)
    path.chmod(0o600)
    return Document(absence_request_id=absence_id, storage_key=key, original_filename=original, content_type=content_type, size_bytes=len(content), sha256=hashlib.sha256(content).hexdigest(), uploaded_by=user_id, uploaded_at=now())


@app.post("/absences")
async def create_absence(
    request: Request, employee_id: int = Form(...), kind: str = Form(...), start_date: date = Form(...), end_date: date = Form(...), return_date: date = Form(...), reason: str = Form(""), planned: bool = Form(False), csrf_token: str = Form(...), medical_document: UploadFile | None = File(None),
    auth: AuthContext = Depends(require_roles("ward_officer", "hr_viewer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    allowed = {"annual_leave", "maternity_leave", "paternity_leave", "compassionate_leave", "sick_off", "official_duty", "unpaid_leave"}
    if kind not in allowed or end_date < start_date or return_date <= end_date:
        raise HTTPException(400, "Absence type and dates are invalid")
    employee = db.get(Employee, employee_id)
    if not employee or not employee.active:
        raise HTTPException(404, "Active employee not found")
    if kind == "sick_off" and len(reason.strip()) < 10:
        raise HTTPException(400, "Provide a sufficient sick-off reason")
    overlapping = db.scalar(select(AbsenceRequest.id).where(AbsenceRequest.employee_id == employee_id, AbsenceRequest.status.in_(("submitted", "approved")), AbsenceRequest.start_date <= end_date, AbsenceRequest.end_date >= start_date))
    if overlapping:
        raise HTTPException(409, "This employee already has an overlapping request")
    item = AbsenceRequest(employee_id=employee_id, kind=kind, start_date=start_date, end_date=end_date, return_date=return_date, reason=reason.strip(), status="planned" if planned else "submitted", submitted_by=auth.user.id, created_at=now())
    db.add(item)
    db.flush()
    if medical_document and medical_document.filename:
        db.add(await save_document(medical_document, item.id, auth.user.id))
    record_audit(db, request, "absence_created", "absence_request", item.id, auth.user.id, f"Status {item.status}")
    db.commit()
    return RedirectResponse("/absences", status_code=303)


@app.get("/absences", response_class=HTMLResponse)
def absences_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    items = db.scalars(select(AbsenceRequest).order_by(AbsenceRequest.created_at.desc())).all()
    employees = db.scalars(select(Employee).where(Employee.active.is_(True)).order_by(Employee.full_name)).all()
    return templates.TemplateResponse(request=request, name="absences.html", context={"auth": auth, "csrf": auth.session.csrf_token, "items": items, "employees": employees})


@app.post("/absences/{absence_id}/{action}")
def absence_action(
    absence_id: int, action: str, request: Request, csrf_token: str = Form(...), review_note: str = Form(""),
    auth: AuthContext = Depends(require_roles("subcounty_reviewer", "hr_viewer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    item = db.get(AbsenceRequest, absence_id)
    if not item or action not in {"approve", "reject", "submit", "cancel"}:
        raise HTTPException(404, "Request or action not found")
    target = {"approve": "approved", "reject": "rejected", "submit": "submitted", "cancel": "cancelled"}[action]
    if action == "reject" and len(review_note.strip()) < 3:
        raise HTTPException(400, "A rejection note is required")
    item.status = target
    item.reviewed_by = auth.user.id
    item.reviewed_at = now()
    item.review_note = review_note.strip() or None
    record_audit(db, request, f"absence_{target}", "absence_request", item.id, auth.user.id, item.review_note)
    db.commit()
    return RedirectResponse("/absences", status_code=303)


@app.get("/documents/{document_id}/download")
def download_document(document_id: int, request: Request, auth: AuthContext = Depends(require_roles("hr_viewer", "system_admin")), db: Session = Depends(get_db)):
    item = db.get(Document, document_id)
    if not item or not (settings.document_root / item.storage_key).is_file():
        raise HTTPException(404, "Document not found")
    record_audit(db, request, "medical_document_downloaded", "document", item.id, auth.user.id)
    db.commit()
    return FileResponse(settings.document_root / item.storage_key, media_type=item.content_type, filename=item.original_filename, headers={"Cache-Control": "private, no-store"})


@app.get("/work-logs", response_class=HTMLResponse)
def work_logs_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    items = db.scalars(select(WorkLog).order_by(WorkLog.work_date.desc(), WorkLog.id.desc())).all()
    return templates.TemplateResponse(request=request, name="work_logs.html", context={"auth": auth, "csrf": auth.session.csrf_token, "items": items, "today": today()})


@app.post("/work-logs")
def create_work_log(
    request: Request, work_date: date = Form(...), activity: str = Form(...), location: str = Form(...), description: str = Form(...), quantity: float | None = Form(None), unit: str | None = Form(None), staff_count: int = Form(0), challenges: str | None = Form(None), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if min(len(activity.strip()), len(location.strip()), len(description.strip())) < 3 or quantity is not None and quantity < 0 or staff_count < 0:
        raise HTTPException(400, "Work log details are invalid")
    item = WorkLog(work_date=work_date, activity=activity.strip()[:160], location=location.strip()[:160], description=description.strip(), quantity=quantity, unit=unit.strip()[:40] if unit else None, staff_count=staff_count, challenges=challenges.strip() if challenges else None, status="submitted", submitted_by=auth.user.id, created_at=now())
    db.add(item)
    db.flush()
    record_audit(db, request, "work_log_submitted", "work_log", item.id, auth.user.id)
    db.commit()
    return RedirectResponse("/work-logs", status_code=303)


@app.post("/work-logs/{log_id}/{action}")
def work_log_action(log_id: int, action: str, request: Request, csrf_token: str = Form(...), review_note: str = Form(""), auth: AuthContext = Depends(require_roles("subcounty_reviewer", "system_admin")), db: Session = Depends(get_db)):
    verify_csrf(auth, csrf_token)
    item = db.get(WorkLog, log_id)
    if not item or action not in {"approve", "reject"}:
        raise HTTPException(404, "Work log or action not found")
    if action == "reject" and len(review_note.strip()) < 3:
        raise HTTPException(400, "A rejection note is required")
    item.status = "approved" if action == "approve" else "rejected"
    item.reviewed_by, item.reviewed_at, item.review_note = auth.user.id, now(), review_note.strip() or None
    record_audit(db, request, f"work_log_{item.status}", "work_log", item.id, auth.user.id, item.review_note)
    db.commit()
    return RedirectResponse("/work-logs", status_code=303)


@app.get("/reports", response_class=HTMLResponse)
def reports_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    records = db.scalars(select(ReportRecord).order_by(ReportRecord.created_at.desc())).all()
    return templates.TemplateResponse(request=request, name="reports.html", context={"auth": auth, "csrf": auth.session.csrf_token, "records": records, "today": today()})


@app.get("/reports/preview", response_class=HTMLResponse)
def report_preview(request: Request, start_date: date, end_date: date, kind: str = "custom", auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    try:
        snapshot = build_snapshot(db, start_date, end_date)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return templates.TemplateResponse(request=request, name="report_period.html", context={"auth": auth, "csrf": auth.session.csrf_token, "snapshot": snapshot, "narrative": deterministic_narrative(snapshot), "kind": kind, "record": None, "generated_at": now()})


@app.post("/reports/finalize")
def finalize_report(request: Request, start_date: date = Form(...), end_date: date = Form(...), kind: str = Form(...), narrative: str = Form(...), csrf_token: str = Form(...), auth: AuthContext = Depends(require_roles("subcounty_reviewer", "system_admin")), db: Session = Depends(get_db)):
    verify_csrf(auth, csrf_token)
    snapshot = build_snapshot(db, start_date, end_date)
    item = ReportRecord(kind=kind, start_date=start_date, end_date=end_date, status="finalized", title=f"{kind.title()} Operations Report", narrative=narrative.strip() or deterministic_narrative(snapshot), snapshot_json=json.dumps(snapshot), created_by=auth.user.id, created_at=now())
    db.add(item)
    db.flush()
    record_audit(db, request, "report_finalized", "report", item.id, auth.user.id, f"{start_date} to {end_date}")
    db.commit()
    return RedirectResponse(f"/reports/{item.id}", status_code=303)


@app.get("/reports/{report_id}", response_class=HTMLResponse)
def saved_report(report_id: str, request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    if report_id.endswith(".csv"):
        try:
            return report_csv(int(report_id.removesuffix(".csv")), request, auth, db)
        except ValueError:
            raise HTTPException(404, "Report not found")
    try:
        numeric_id = int(report_id)
    except ValueError:
        raise HTTPException(404, "Report not found")
    item = db.get(ReportRecord, numeric_id)
    if not item:
        raise HTTPException(404, "Report not found")
    return templates.TemplateResponse(request=request, name="report_period.html", context={"auth": auth, "csrf": auth.session.csrf_token, "snapshot": json.loads(item.snapshot_json), "narrative": item.narrative, "kind": item.kind, "record": item, "generated_at": item.created_at})


@app.get("/reports/{report_id}.csv")
def report_csv(report_id: int, request: Request, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    item = db.get(ReportRecord, report_id)
    if not item:
        raise HTTPException(404, "Report not found")
    snapshot = json.loads(item.snapshot_json)
    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow(["Work date", "Employee ID", "Employee name", "Role", "Status", "Details", "Activity", "Location"])
    for day in snapshot["days"]:
        for row in day["roster"]:
            safe = lambda value: f"'{value}" if str(value).startswith(("=", "+", "-", "@")) else value
            writer.writerow([day["date"], safe(row["employee_number"]), safe(row["full_name"]), safe(row["role"]), row["status"], safe(row["detail"]), safe(day["activity"]), safe(day["location"])])
    record_audit(db, request, "report_csv_exported", "report", item.id, auth.user.id)
    db.commit()
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="makina-{item.kind}-{item.start_date}.csv"'})


@app.post("/reports/ai-draft", response_class=HTMLResponse)
def generate_ai_draft(request: Request, start_date: date = Form(...), end_date: date = Form(...), kind: str = Form(...), csrf_token: str = Form(...), auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db)):
    verify_csrf(auth, csrf_token)
    snapshot = build_snapshot(db, start_date, end_date)
    narrative = ai_narrative(snapshot)
    record_audit(db, request, "report_narrative_drafted", "report", actor_user_id=auth.user.id, details="AI enabled" if settings.ai_enabled else "Deterministic fallback")
    db.commit()
    return templates.TemplateResponse(request=request, name="report_period.html", context={"auth": auth, "csrf": auth.session.csrf_token, "snapshot": snapshot, "narrative": narrative, "kind": kind, "record": None, "generated_at": now()})


@app.post("/reminders/run")
def run_reminders(request: Request, csrf_token: str = Form(...), auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db)):
    verify_csrf(auth, csrf_token)
    count = process_leave_reminders(db)
    record_audit(db, request, "leave_reminders_processed", "reminder", actor_user_id=auth.user.id, details=f"{count} processed")
    db.commit()
    return RedirectResponse("/#leave", status_code=303)


@app.get("/audit", response_class=HTMLResponse)
def audit_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    if auth.user.role not in {"subcounty_reviewer", "system_admin"}:
        raise HTTPException(403, "You do not have permission for this action")
    events = db.scalars(select(AuditEvent).order_by(AuditEvent.occurred_at.desc()).limit(250)).all()
    return templates.TemplateResponse(request=request, name="audit.html", context={"auth": auth, "csrf": auth.session.csrf_token, "events": events})


@app.get("/admin/users", response_class=HTMLResponse)
def users_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    if auth.user.role != "system_admin":
        raise HTTPException(403, "System administrator access is required")
    users = db.scalars(select(User).order_by(User.display_name)).all()
    return templates.TemplateResponse(request=request, name="users.html", context={"auth": auth, "csrf": auth.session.csrf_token, "users": users})


@app.post("/admin/users")
def create_user(
    request: Request, display_name: str = Form(...), email: str = Form(...), role: str = Form(...), password: str = Form(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    roles = {"ward_officer", "subcounty_reviewer", "hr_viewer", "system_admin"}
    if role not in roles or len(password) < 12 or len(display_name.strip()) < 3:
        raise HTTPException(400, "Valid details and a password of at least 12 characters are required")
    item = User(email=email.strip().lower(), display_name=display_name.strip()[:120], password_hash=hash_password(password), role=role, must_change_password=True, created_at=now())
    db.add(item)
    try:
        db.flush()
        record_audit(db, request, "user_created", "user", item.id, auth.user.id, f"Role {role}")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A user with this email already exists")
    return RedirectResponse("/admin/users", status_code=303)


@app.post("/account/password")
def change_password(
    request: Request, current_password: str = Form(...), new_password: str = Form(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_user), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if not verify_password(current_password, auth.user.password_hash) or len(new_password) < 12:
        raise HTTPException(400, "Current password is incorrect or the new password is too short")
    auth.user.password_hash = hash_password(new_password)
    auth.user.must_change_password = False
    sessions = db.scalars(select(UserSession).where(UserSession.user_id == auth.user.id, UserSession.id != auth.session.id, UserSession.revoked_at.is_(None))).all()
    for session in sessions:
        session.revoked_at = now()
    record_audit(db, request, "password_changed", "user", auth.user.id, auth.user.id)
    db.commit()
    return RedirectResponse("/", status_code=303)


@app.get("/health/live")
def liveness():
    return {"status": "ok"}


@app.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    if not settings.document_root.is_dir():
        raise HTTPException(503, "Document storage unavailable")
    return {"status": "ready"}


@app.get("/health", include_in_schema=False)
def legacy_health():
    return {"status": "ok"}
