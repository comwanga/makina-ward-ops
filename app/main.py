import csv
import asyncio
import hashlib
import io
import json
import os
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
from .importing import normalize_roster_status, parse_roster
from .models import AccessRequest, AbsenceRequest, Attendance, AttendanceSession, AuditEvent, Document, DocumentClassification, Employee, EmployeeProfile, ReminderDelivery, ReportRecord, User, UserSession, WorkLog, WorkLogDetail, WorkPhoto
from .notifications import process_leave_reminders
from .reporting import ai_narrative, build_snapshot, deterministic_narrative, deterministic_recommendations
from .services import daily_roster, dashboard_data, now, today


ROOT = Path(__file__).resolve().parent.parent
settings.document_root.mkdir(parents=True, exist_ok=True, mode=0o700)
templates = Jinja2Templates(directory=ROOT / "templates")
CHECKIN_ATTEMPTS: dict[str, tuple[int, object]] = {}


def initialize_database() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if settings.app_env == "development" and db.scalar(select(User.id).limit(1)) is None:
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


def owner_setup_available(db: Session) -> bool:
    if db.scalar(select(AuditEvent.id).where(AuditEvent.action == "owner_setup_completed")):
        return False
    users = db.scalars(select(User).order_by(User.id)).all()
    if not users:
        return True
    return len(users) == 1 and users[0].role == "system_admin" and users[0].email == settings.bootstrap_email.lower()


@app.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request, db: Session = Depends(get_db)):
    if not owner_setup_available(db):
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(request=request, name="setup.html", context={"error": None})


@app.post("/setup", response_class=HTMLResponse)
def setup_owner(
    request: Request, setup_token: str = Form(...), display_name: str = Form(...), email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db),
):
    if not owner_setup_available(db):
        raise HTTPException(409, "Owner setup has already been completed")
    if not settings.owner_setup_token or not secrets.compare_digest(setup_token, settings.owner_setup_token):
        return templates.TemplateResponse(request=request, name="setup.html", context={"error": "The owner setup token is incorrect"}, status_code=403)
    normalized_email = email.strip().lower()
    if len(display_name.strip()) < 3 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email) or len(password) < 12:
        return templates.TemplateResponse(request=request, name="setup.html", context={"error": "Enter a valid name, email and password of at least 12 characters"}, status_code=400)
    owner = db.scalar(select(User).order_by(User.id).limit(1))
    if owner:
        owner.display_name, owner.email, owner.password_hash = display_name.strip()[:120], normalized_email, hash_password(password)
        owner.must_change_password = False
        owner.active = True
    else:
        owner = User(email=normalized_email, display_name=display_name.strip()[:120], password_hash=hash_password(password), role="system_admin", active=True, must_change_password=False, created_at=now())
        db.add(owner)
    db.flush()
    raw, _ = create_user_session(db, owner)
    record_audit(db, request, "owner_setup_completed", "user", owner.id, owner.id)
    db.commit()
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE_NAME, raw, httponly=True, secure=settings.secure_cookies, samesite="lax", max_age=settings.session_hours * 3600)
    return response


@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request):
    register_csrf = secrets.token_urlsafe(24)
    response = templates.TemplateResponse(request=request, name="register.html", context={"error": None, "success": None, "register_csrf": register_csrf})
    response.set_cookie("register_csrf", register_csrf, httponly=True, secure=settings.secure_cookies, samesite="strict", max_age=1800)
    return response


@app.post("/register", response_class=HTMLResponse)
def register_access(
    request: Request, display_name: str = Form(...), email: str = Form(...), password: str = Form(...), reason: str = Form(...), register_csrf: str = Form(...), db: Session = Depends(get_db),
):
    if not secrets.compare_digest(request.cookies.get("register_csrf", ""), register_csrf):
        raise HTTPException(403, "Invalid form security token")
    normalized_email = email.strip().lower()
    error = None
    if len(display_name.strip()) < 3 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email):
        error = "Enter a valid name and email address"
    elif len(password) < 12:
        error = "Password must contain at least 12 characters"
    elif len(reason.strip()) < 10:
        error = "Explain briefly why you need access"
    elif db.scalar(select(User.id).where(User.email == normalized_email)):
        error = "An account with this email already exists"
    elif db.scalar(select(AccessRequest.id).where(AccessRequest.email == normalized_email, AccessRequest.status == "pending")):
        error = "An access request for this email is already awaiting review"
    if error:
        return templates.TemplateResponse(request=request, name="register.html", context={"error": error, "success": None, "register_csrf": register_csrf}, status_code=400)
    item = AccessRequest(display_name=display_name.strip()[:120], email=normalized_email, password_hash=hash_password(password), reason=reason.strip(), status="pending", created_at=now())
    db.add(item)
    db.flush()
    record_audit(db, request, "access_requested", "access_request", item.id, details="Public read-only access request")
    db.commit()
    return templates.TemplateResponse(request=request, name="register.html", context={"error": None, "success": "Your request was sent to the system owner for approval.", "register_csrf": register_csrf})


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if auth:
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(request=request, name="login.html", context={"error": None, "setup_available": owner_setup_available(db)})


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
    pending_access = db.scalars(select(AccessRequest).where(AccessRequest.status == "pending").order_by(AccessRequest.created_at)).all() if auth.user.role == "system_admin" else []
    manual_candidates = [row["employee"] for row in data["roster"] if row["status"] == "absent"]
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={**data, "session": session, "employees": employees, "manual_candidates": manual_candidates, "now": now(), "auth": auth, "csrf": auth.session.csrf_token, "requests": requests, "work_logs": work_logs, "deliveries": deliveries, "pending_access": pending_access},
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
    if re.fullmatch(r"[17]\d{8}", clean):
        clean = f"0{clean}"
    if not re.fullmatch(r"(?:\+254|0)\d{9}", clean):
        raise HTTPException(400, "Enter a valid Kenyan phone number")
    return clean


@app.post("/attendance/supervised")
def supervised_attendance(
    request: Request, employee_id: int = Form(...), attendance_status: str = Form("present"), reason: str = Form(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if len(reason.strip()) < 5 or attendance_status not in {"present", "absent", "off_duty"}:
        raise HTTPException(400, "A reason is required for supervised attendance")
    employee = db.get(Employee, employee_id)
    session = db.scalar(select(AttendanceSession).where(AttendanceSession.work_date == today()).order_by(AttendanceSession.created_at.desc()))
    if not employee or not employee.active or not session:
        raise HTTPException(404, "Employee or today's attendance session was not found")
    existing = db.scalar(select(Attendance).where(Attendance.employee_id == employee.id, Attendance.work_date == today()))
    roster_row = next((row for row in daily_roster(db, today()) if row["employee"].id == employee.id), None)
    if existing or not roster_row or roster_row["status"] != "absent":
        raise HTTPException(409, "Manual status is only allowed for staff who did not check in and remain absent")
    db.add(Attendance(employee_id=employee.id, session_id=session.id, work_date=today(), checked_at=now(), status=attendance_status))
    try:
        db.flush()
        record_audit(db, request, "attendance_manual_exception", "employee", employee.id, auth.user.id, f"{attendance_status}: {reason.strip()}")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Attendance already exists for this employee today")
    return RedirectResponse("/#staff", status_code=303)


@app.get("/attendance/history", response_class=HTMLResponse)
def attendance_history(request: Request, report_date: date | None = None, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    selected = report_date or today()
    data = dashboard_data(db, selected)
    roster_ids = {row["employee"].id for row in data["roster"]}
    historical_records = db.scalars(select(Attendance).where(Attendance.work_date == selected)).all()
    for record in historical_records:
        if record.employee_id not in roster_ids:
            data["roster"].append({"employee": record.employee, "status": record.status, "detail": record.checked_at.strftime("%H:%M")})
            data["counts"][record.status] = data["counts"].get(record.status, 0) + 1
            data["total"] += 1
    data["roster"].sort(key=lambda row: row["employee"].full_name)
    session = db.scalar(select(AttendanceSession).where(AttendanceSession.work_date == selected).order_by(AttendanceSession.created_at.desc()))
    archived_reports = db.scalars(select(ReportRecord).where(ReportRecord.kind == "daily", ReportRecord.start_date == selected, ReportRecord.end_date == selected).order_by(ReportRecord.created_at.desc())).all()
    return templates.TemplateResponse(request=request, name="attendance_history.html", context={**data, "selected": selected, "session": session, "archived_reports": archived_reports, "auth": auth, "csrf": auth.session.csrf_token})


@app.post("/employees")
def add_employee(
    request: Request, employee_number: str = Form(...), full_name: str = Form(...), phone: str = Form(...), email: str | None = Form(None), role: str = Form("Green Army Staff"), residence: str = Form(""), roster_status: str = Form("on_duty"), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if len(full_name.strip()) < 3 or len(role.strip()) < 2:
        raise HTTPException(400, "Name and role are required")
    item = Employee(employee_number=employee_number.strip().upper()[:30], full_name=full_name.strip()[:120], phone=normalized_phone(phone), email=email.strip().lower() if email else None, role=role.strip()[:80])
    db.add(item)
    try:
        db.flush()
        db.add(EmployeeProfile(employee_id=item.id, residence=residence.strip()[:160] or None, roster_status=normalize_roster_status(roster_status), updated_at=now()))
        record_audit(db, request, "employee_created", "employee", item.id, auth.user.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Employee number or phone already exists")
    return RedirectResponse("/#staff", status_code=303)


@app.post("/employees/import")
async def import_employees(
    request: Request, roster_file: UploadFile = File(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    content = await roster_file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "Staff roster must be below 5 MB")
    try:
        rows = parse_roster(content, roster_file.filename or "")
    except (ValueError, UnicodeDecodeError, KeyError) as exc:
        raise HTTPException(400, str(exc))
    if not rows:
        raise HTTPException(400, "Staff roster contains no data rows")
    if len(rows) > 5000:
        raise HTTPException(400, "Employee CSV cannot exceed 5,000 rows")
    seen: set[str] = set()
    created = updated = 0
    for number, row in enumerate(rows, start=2):
        employee_number = row.get("employee_number", "").strip().upper()
        if not employee_number or len(employee_number) > 30 or employee_number in seen or len(row.get("full_name", "").strip()) < 3:
            raise HTTPException(400, f"Invalid or duplicate employee at CSV row {number}")
        seen.add(employee_number)
        try:
            phone = normalized_phone(row.get("phone", ""))
            roster_status = normalize_roster_status(row.get("status", ""))
        except (ValueError, HTTPException) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            raise HTTPException(400, f"Row {number}: {detail}")
        employee = db.scalar(select(Employee).where(Employee.employee_number == employee_number))
        if employee:
            employee.full_name, employee.phone, employee.role = row["full_name"].strip()[:120], phone, row.get("role", "").strip()[:80] or employee.role
            employee.email = row.get("email", "").strip().lower() or None
            employee.active = True
            updated += 1
        else:
            employee = Employee(employee_number=employee_number, full_name=row["full_name"].strip()[:120], phone=phone, email=row.get("email", "").strip().lower() or None, role=row.get("role", "").strip()[:80] or "Green Army Staff")
            db.add(employee)
            db.flush()
            created += 1
        profile = employee.profile or EmployeeProfile(employee_id=employee.id, updated_at=now())
        profile.residence = row["residence"].strip()[:160] or None
        profile.roster_status = roster_status
        profile.updated_at = now()
        if not employee.profile:
            db.add(profile)
    record_audit(db, request, "employees_imported", "employee", actor_user_id=auth.user.id, details=f"{created} created, {updated} updated")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Roster contains a phone or employee ID already assigned to another employee")
    return RedirectResponse("/employees", status_code=303)


@app.get("/employees", response_class=HTMLResponse)
def employees_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    if auth.user.role == "read_only":
        raise HTTPException(403, "Benchmark accounts cannot access staff contact details")
    employees = db.scalars(select(Employee).order_by(Employee.active.desc(), Employee.full_name)).all()
    return templates.TemplateResponse(request=request, name="employees.html", context={"auth": auth, "csrf": auth.session.csrf_token, "employees": employees})


@app.post("/employees/{employee_id}/edit")
def edit_employee(
    employee_id: int, request: Request, full_name: str = Form(...), employee_number: str = Form(...), phone: str = Form(...), residence: str = Form(""), roster_status: str = Form("on_duty"), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    employee = db.get(Employee, employee_id)
    if not employee or len(full_name.strip()) < 3:
        raise HTTPException(404, "Employee not found")
    employee.full_name, employee.employee_number, employee.phone = full_name.strip()[:120], employee_number.strip().upper()[:30], normalized_phone(phone)
    profile = employee.profile or EmployeeProfile(employee_id=employee.id, updated_at=now())
    profile.residence, profile.roster_status, profile.updated_at = residence.strip()[:160] or None, normalize_roster_status(roster_status), now()
    if not employee.profile:
        db.add(profile)
    record_audit(db, request, "employee_updated", "employee", employee.id, auth.user.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Employee ID or phone already belongs to another employee")
    return RedirectResponse("/employees", status_code=303)


@app.post("/employees/{employee_id}/status")
def change_employee_active_status(
    employee_id: int, request: Request, active: bool = Form(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(404, "Employee not found")
    employee.active = active
    record_audit(db, request, "employee_reactivated" if active else "employee_deactivated", "employee", employee.id, auth.user.id)
    db.commit()
    return RedirectResponse("/employees", status_code=303)


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
    request: Request, employee_id: int = Form(...), kind: str = Form(...), start_date: date = Form(...), end_date: date = Form(...), return_date: date = Form(...), reason: str = Form(""), planned: bool = Form(False), document_category: str = Form("other"), csrf_token: str = Form(...), supporting_document: UploadFile | None = File(None), medical_document: UploadFile | None = File(None),
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
    upload = supporting_document if supporting_document and supporting_document.filename else medical_document
    if upload and upload.filename:
        allowed_categories = {"sick_sheet", "medical_certificate", "leave_form", "leave_approval", "return_to_work", "other"}
        if document_category not in allowed_categories:
            raise HTTPException(400, "Document category is invalid")
        document = await save_document(upload, item.id, auth.user.id)
        db.add(document)
        db.flush()
        db.add(DocumentClassification(document_id=document.id, category=document_category))
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
    category = item.classification.category if item.classification else "legacy_medical_document"
    record_audit(db, request, "absence_document_downloaded", "document", item.id, auth.user.id, category)
    db.commit()
    return FileResponse(settings.document_root / item.storage_key, media_type=item.content_type, filename=item.original_filename, headers={"Cache-Control": "private, no-store"})


@app.get("/work-logs", response_class=HTMLResponse)
def work_logs_page(request: Request, auth: AuthContext | None = Depends(optional_user), db: Session = Depends(get_db)):
    if not auth:
        return redirect_login()
    items = db.scalars(select(WorkLog).order_by(WorkLog.work_date.desc(), WorkLog.id.desc())).all()
    return templates.TemplateResponse(request=request, name="work_logs.html", context={"auth": auth, "csrf": auth.session.csrf_token, "items": items, "today": today()})


async def save_work_photo(upload: UploadFile, work_log_id: int, user_id: int, caption: str | None) -> WorkPhoto:
    content = await upload.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(400, "Each field photo must be below 5 MB")
    signatures = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}
    content_type = next((mime for signature, mime in signatures.items() if content.startswith(signature)), None)
    if not content_type:
        raise HTTPException(400, "Field photos must be genuine JPG or PNG images")
    key = secrets.token_hex(24)
    path = settings.document_root / key
    path.write_bytes(content)
    path.chmod(0o600)
    return WorkPhoto(work_log_id=work_log_id, storage_key=key, original_filename=Path(upload.filename or "field-photo").name[:200], content_type=content_type, size_bytes=len(content), sha256=hashlib.sha256(content).hexdigest(), caption=caption.strip()[:240] if caption else None, uploaded_by=user_id, uploaded_at=now())


@app.post("/work-logs")
async def create_work_log(
    request: Request, work_date: date = Form(...), activity: str = Form(...), location: str = Form(...), description: str = Form(...), quantity: float | None = Form(None), unit: str | None = Form(None), staff_count: int = Form(0), challenges: str | None = Form(None), completion_status: str = Form("complete"), outstanding_work: str = Form(""), photo_caption: str = Form(""), csrf_token: str = Form(...), photos: list[UploadFile] = File(default=[]),
    auth: AuthContext = Depends(require_roles("ward_officer", "system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    if min(len(activity.strip()), len(location.strip()), len(description.strip())) < 3 or quantity is not None and quantity < 0 or staff_count < 0 or completion_status not in {"complete", "incomplete"}:
        raise HTTPException(400, "Work log details are invalid")
    if completion_status == "incomplete" and len(outstanding_work.strip()) < 5:
        raise HTTPException(400, "Describe the outstanding work for an incomplete activity")
    photos = [photo for photo in photos if photo.filename]
    if len(photos) > 8:
        raise HTTPException(400, "A work log can contain at most 8 photos")
    item = WorkLog(work_date=work_date, activity=activity.strip()[:160], location=location.strip()[:160], description=description.strip(), quantity=quantity, unit=unit.strip()[:40] if unit else None, staff_count=staff_count, challenges=challenges.strip() if challenges else None, status="submitted", submitted_by=auth.user.id, created_at=now())
    db.add(item)
    db.flush()
    db.add(WorkLogDetail(work_log_id=item.id, completion_status=completion_status, outstanding_work=outstanding_work.strip() or None))
    stored_paths: list[Path] = []
    try:
        for photo in photos:
            stored = await save_work_photo(photo, item.id, auth.user.id, photo_caption)
            stored_paths.append(settings.document_root / stored.storage_key)
            db.add(stored)
        record_audit(db, request, "work_log_submitted", "work_log", item.id, auth.user.id)
        db.commit()
    except Exception:
        db.rollback()
        for path in stored_paths:
            path.unlink(missing_ok=True)
        raise
    return RedirectResponse("/work-logs", status_code=303)


@app.get("/work-photos/{photo_id}")
def view_work_photo(photo_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    photo = db.get(WorkPhoto, photo_id)
    path = settings.document_root / photo.storage_key if photo else None
    if not photo or not path or not path.is_file():
        raise HTTPException(404, "Field photo not found")
    if hashlib.sha256(path.read_bytes()).hexdigest() != photo.sha256:
        raise HTTPException(409, "Field photo integrity check failed")
    return FileResponse(path, media_type=photo.content_type, headers={"Cache-Control": "private, max-age=300"})


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
    return templates.TemplateResponse(request=request, name="report_period.html", context={"auth": auth, "csrf": auth.session.csrf_token, "snapshot": snapshot, "narrative": deterministic_narrative(snapshot), "recommendations": deterministic_recommendations(snapshot), "kind": kind, "record": None, "generated_at": now(), "signed_by": auth.user.display_name})


@app.post("/reports/finalize")
def finalize_report(request: Request, start_date: date = Form(...), end_date: date = Form(...), kind: str = Form(...), narrative: str = Form(...), recommendations: str = Form(...), csrf_token: str = Form(...), auth: AuthContext = Depends(require_roles("subcounty_reviewer", "system_admin")), db: Session = Depends(get_db)):
    verify_csrf(auth, csrf_token)
    snapshot = build_snapshot(db, start_date, end_date)
    generated_at = now()
    snapshot["recommendations"] = recommendations.strip() or deterministic_recommendations(snapshot)
    snapshot["signed_by"] = auth.user.display_name
    snapshot["signed_title"] = "Ward Environment Officer" if auth.user.role == "system_admin" else auth.user.role.replace("_", " ").title()
    snapshot["generated_at"] = generated_at.isoformat()
    item = ReportRecord(kind=kind, start_date=start_date, end_date=end_date, status="finalized", title=f"{kind.title()} Operations Report", narrative=narrative.strip() or deterministic_narrative(snapshot), snapshot_json=json.dumps(snapshot), created_by=auth.user.id, created_at=generated_at)
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
    snapshot = json.loads(item.snapshot_json)
    return templates.TemplateResponse(request=request, name="report_period.html", context={"auth": auth, "csrf": auth.session.csrf_token, "snapshot": snapshot, "narrative": item.narrative, "recommendations": snapshot.get("recommendations", "Not recorded"), "kind": item.kind, "record": item, "generated_at": item.created_at, "signed_by": snapshot.get("signed_by", "Ward Environment Officer"), "signed_title": snapshot.get("signed_title", "Ward Environment Officer")})


@app.get("/reports/{report_id}.csv")
def report_csv(report_id: int, request: Request, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    if auth.user.role == "read_only":
        raise HTTPException(403, "Read-only benchmark accounts cannot export operational data")
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
    return templates.TemplateResponse(request=request, name="report_period.html", context={"auth": auth, "csrf": auth.session.csrf_token, "snapshot": snapshot, "narrative": narrative, "recommendations": deterministic_recommendations(snapshot), "kind": kind, "record": None, "generated_at": now(), "signed_by": auth.user.display_name})


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
    access_requests = db.scalars(select(AccessRequest).order_by(AccessRequest.created_at.desc())).all()
    return templates.TemplateResponse(request=request, name="users.html", context={"auth": auth, "csrf": auth.session.csrf_token, "users": users, "access_requests": access_requests})


@app.post("/admin/users")
def create_user(
    request: Request, display_name: str = Form(...), email: str = Form(...), role: str = Form(...), password: str = Form(...), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_roles("system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    roles = {"read_only", "ward_officer", "subcounty_reviewer", "hr_viewer", "system_admin"}
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


@app.post("/admin/access-requests/{request_id}/{action}")
def review_access_request(
    request_id: int, action: str, request: Request, csrf_token: str = Form(...), review_note: str = Form(""),
    auth: AuthContext = Depends(require_roles("system_admin")), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    item = db.get(AccessRequest, request_id)
    if not item or item.status != "pending" or action not in {"approve", "reject"}:
        raise HTTPException(404, "Pending access request not found")
    if action == "approve":
        if db.scalar(select(User.id).where(User.email == item.email)):
            raise HTTPException(409, "An account with this email already exists")
        user = User(email=item.email, display_name=item.display_name, password_hash=item.password_hash, role="read_only", active=True, must_change_password=False, created_at=now())
        db.add(user)
        db.flush()
        item.status = "approved"
        details = f"Read-only user {user.id} created"
    else:
        item.status = "rejected"
        details = review_note.strip() or "Access declined"
    item.reviewed_by, item.reviewed_at, item.review_note = auth.user.id, now(), review_note.strip() or None
    record_audit(db, request, f"access_request_{item.status}", "access_request", item.id, auth.user.id, details)
    db.commit()
    return RedirectResponse("/admin/users", status_code=303)


@app.get("/account", response_class=HTMLResponse)
def account_page(request: Request, auth: AuthContext | None = Depends(optional_user)):
    if not auth:
        return redirect_login()
    return templates.TemplateResponse(request=request, name="account.html", context={"auth": auth, "csrf": auth.session.csrf_token, "error": None})


@app.post("/account", response_class=HTMLResponse)
def update_account(
    request: Request, display_name: str = Form(...), email: str = Form(...), current_password: str = Form(...), new_password: str = Form(""), csrf_token: str = Form(...),
    auth: AuthContext = Depends(require_user), db: Session = Depends(get_db),
):
    verify_csrf(auth, csrf_token)
    normalized_email = email.strip().lower()
    error = None
    if not verify_password(current_password, auth.user.password_hash):
        error = "Current password is incorrect"
    elif len(display_name.strip()) < 3 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email):
        error = "Enter a valid name and email address"
    elif new_password and len(new_password) < 12:
        error = "The new password must contain at least 12 characters"
    elif db.scalar(select(User.id).where(User.email == normalized_email, User.id != auth.user.id)):
        error = "Another account already uses this email address"
    if error:
        return templates.TemplateResponse(request=request, name="account.html", context={"auth": auth, "csrf": auth.session.csrf_token, "error": error}, status_code=400)
    auth.user.display_name, auth.user.email = display_name.strip()[:120], normalized_email
    if new_password:
        auth.user.password_hash = hash_password(new_password)
    auth.user.must_change_password = False
    record_audit(db, request, "account_updated", "user", auth.user.id, auth.user.id)
    db.commit()
    return RedirectResponse("/account", status_code=303)


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
    if not settings.document_root.is_dir() or not os.access(settings.document_root, os.W_OK):
        raise HTTPException(503, "Document storage unavailable")
    return {"status": "ready"}


@app.get("/health", include_in_schema=False)
def legacy_health():
    return {"status": "ok"}
