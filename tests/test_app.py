import os
import re
import tempfile
from io import BytesIO
from datetime import timedelta

os.environ.setdefault("TZ", "Africa/Nairobi")
test_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
test_database.close()
os.environ["DATABASE_URL"] = f"sqlite:///{test_database.name}"
os.environ["APP_ENV"] = "development"

from fastapi.testclient import TestClient
from sqlalchemy import select
from openpyxl import Workbook

from app.database import Base, SessionLocal, engine, normalize_database_url
from app.config import settings
from app.main import app
from app.models import AccessRequest, AbsenceRequest, Attendance, Document, Employee, ReminderDelivery, ReportRecord, User, WorkLog, WorkPhoto
from app.notifications import process_leave_reminders
from app.reporting import structured_ai_payload
from app.services import daily_roster, today


def setup_function():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def login(client: TestClient) -> str:
    response = client.post(
        "/login",
        data={"email": "officer@makina.local", "password": "ChangeMe123!"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    page = client.get("/")
    assert page.status_code == 200
    return re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)


def create_attendance_session(client: TestClient, csrf: str) -> str:
    response = client.post(
        "/sessions",
        data={"activity": "Drainage clearing", "location": "Makina Market", "duration": "120", "csrf_token": csrf},
        follow_redirects=False,
    )
    assert response.status_code == 303
    page = client.get("/")
    return re.search(r'href="/check-in/([^"]+)"', page.text).group(1)


def test_health_and_anonymous_boundary():
    with TestClient(app) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        assert client.get("/health/ready").json() == {"status": "ready"}
        assert client.get("/", follow_redirects=False).status_code == 303
        assert client.post("/sessions", data={}).status_code == 401


def test_railway_postgres_url_uses_installed_driver():
    assert normalize_database_url("postgresql://user:pass@host/db") == "postgresql+psycopg://user:pass@host/db"
    assert normalize_database_url("postgres://user:pass@host/db") == "postgresql+psycopg://user:pass@host/db"


def test_ai_payload_excludes_personal_and_free_text_data():
    payload = structured_ai_payload(
        {
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "totals": {"present": 6, "absent": 1},
            "work_logs": [
                {
                    "date": "2026-08-01",
                    "activity": "Drainage clearing",
                    "location": "Makina Market",
                    "description": "Employee Jane cleared the drain",
                    "quantity": 120,
                    "unit": "metres",
                    "staff_count": 6,
                    "challenges": "Medical details must remain private",
                }
            ],
        }
    )
    encoded = str(payload)
    assert "Jane" not in encoded
    assert "Medical details" not in encoded
    assert payload["approved_work"][0]["quantity"] == 120


def test_owner_can_replace_bootstrap_account_once():
    original_token = settings.owner_setup_token
    object.__setattr__(settings, "owner_setup_token", "one-time-owner-token")
    try:
        with TestClient(app) as client:
            response = client.post(
                "/setup",
                data={"setup_token": "one-time-owner-token", "display_name": "Ward Owner", "email": "owner@example.go.ke", "password": "OwnerPassword123!"},
                follow_redirects=False,
            )
            assert response.status_code == 303
            assert client.get("/").status_code == 200
            assert client.get("/setup", follow_redirects=False).status_code == 303
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.email == "owner@example.go.ke"))
                assert owner.role == "system_admin"
                assert owner.must_change_password is False
    finally:
        object.__setattr__(settings, "owner_setup_token", original_token)


def test_owner_approves_read_only_signup():
    with TestClient(app) as owner_client:
        csrf = login(owner_client)
        registration = owner_client.get("/register")
        register_csrf = re.search(r'name="register_csrf" value="([^"]+)"', registration.text).group(1)
        requested = owner_client.post(
            "/register",
            data={
                "display_name": "Benchmark Visitor",
                "email": "visitor@example.go.ke",
                "password": "VisitorPassword123!",
                "reason": "I want to benchmark ward reporting operations",
                "register_csrf": register_csrf,
            },
        )
        assert "sent to the system owner" in requested.text
        with SessionLocal() as db:
            access_request = db.scalar(select(AccessRequest).where(AccessRequest.email == "visitor@example.go.ke"))
            assert access_request.status == "pending"

        unapproved_client = TestClient(app)
        unapproved_login = unapproved_client.post("/login", data={"email": "visitor@example.go.ke", "password": "VisitorPassword123!"})
        assert unapproved_login.status_code == 401

        approved = owner_client.post(
            f"/admin/access-requests/{access_request.id}/approve",
            data={"csrf_token": csrf, "review_note": "Benchmark approved"},
            follow_redirects=False,
        )
        assert approved.status_code == 303

        visitor_client = TestClient(app)
        visitor_login = visitor_client.post(
            "/login",
            data={"email": "visitor@example.go.ke", "password": "VisitorPassword123!"},
            follow_redirects=False,
        )
        assert visitor_login.status_code == 303
        assert "Read-only benchmark access" in visitor_client.get("/").text
        forbidden = visitor_client.post(
            "/sessions",
            data={"activity": "Not allowed", "location": "Makina", "duration": "60", "csrf_token": "irrelevant"},
        )
        assert forbidden.status_code == 403


def test_csrf_is_required_for_privileged_changes():
    with TestClient(app) as client:
        login(client)
        response = client.post(
            "/sessions",
            data={"activity": "Clean-up", "location": "Makina", "duration": "120", "csrf_token": "wrong"},
        )
        assert response.status_code == 403


def test_verified_checkin_and_duplicate_prevention():
    with TestClient(app) as client:
        csrf = login(client)
        token = create_attendance_session(client, csrf)
        checkin_page = client.get(f"/check-in/{token}")
        public_csrf = re.search(r'name="public_csrf" value="([^"]+)"', checkin_page.text).group(1)
        checked = client.post(
            f"/check-in/{token}",
            data={"employee_number": "ncc-1042", "phone_last_four": "5601", "public_csrf": public_csrf},
        )
        assert "Attendance confirmed" in checked.text
        duplicate = client.post(
            f"/check-in/{token}",
            data={"employee_number": "NCC-1042", "phone_last_four": "5601", "public_csrf": public_csrf},
        )
        assert "already been recorded" in duplicate.text
        with SessionLocal() as db:
            records = db.scalars(select(Attendance)).all()
            assert len(records) == 1


def test_short_phone_suffix_is_rejected():
    with TestClient(app) as client:
        csrf = login(client)
        token = create_attendance_session(client, csrf)
        checkin_page = client.get(f"/check-in/{token}")
        public_csrf = re.search(r'name="public_csrf" value="([^"]+)"', checkin_page.text).group(1)
        response = client.post(
            f"/check-in/{token}",
            data={"employee_number": "NCC-1042", "phone_last_four": "1", "public_csrf": public_csrf},
        )
        assert "exactly the last four" in response.text


def test_approved_leave_reconciles_roster():
    with TestClient(app) as client:
        csrf = login(client)
        with SessionLocal() as db:
            employee = db.scalar(select(Employee).where(Employee.employee_number == "NCC-1187"))
        start = today()
        response = client.post(
            "/absences",
            data={
                "employee_id": employee.id,
                "kind": "annual_leave",
                "start_date": start.isoformat(),
                "end_date": start.isoformat(),
                "return_date": (start + timedelta(days=1)).isoformat(),
                "reason": "Annual leave schedule",
                "csrf_token": csrf,
            },
            follow_redirects=False,
        )
        assert response.status_code == 303
        with SessionLocal() as db:
            request = db.scalar(select(AbsenceRequest))
        approved = client.post(
            f"/absences/{request.id}/approve",
            data={"csrf_token": csrf, "review_note": "Approved"},
            follow_redirects=False,
        )
        assert approved.status_code == 303
        with SessionLocal() as db:
            row = next(item for item in daily_roster(db, start) if item["employee"].id == employee.id)
            assert row["status"] == "leave"


def test_work_log_final_report_and_csv_are_stable():
    with TestClient(app) as client:
        csrf = login(client)
        work_response = client.post(
            "/work-logs",
            data={
                "work_date": today().isoformat(),
                "activity": "Drainage clearing",
                "location": "Makina Market",
                "description": "Cleared blocked roadside drainage",
                "quantity": "120",
                "unit": "metres",
                "staff_count": "6",
                "challenges": "Heavy silt",
                "completion_status": "incomplete",
                "outstanding_work": "Complete the final twenty metres",
                "photo_caption": "Drainage cleared near the market",
                "csrf_token": csrf,
            },
            files={"photos": ("field.jpg", b"\xff\xd8\xff\xe0field-photo", "image/jpeg")},
            follow_redirects=False,
        )
        assert work_response.status_code == 303
        with SessionLocal() as db:
            work = db.scalar(select(WorkLog))
        client.post(f"/work-logs/{work.id}/approve", data={"csrf_token": csrf, "review_note": "Verified"})
        final = client.post(
            "/reports/finalize",
            data={"start_date": today().isoformat(), "end_date": today().isoformat(), "kind": "daily", "narrative": "Verified daily report.", "recommendations": "Complete the remaining twenty metres.", "csrf_token": csrf},
            follow_redirects=False,
        )
        assert final.status_code == 303
        with SessionLocal() as db:
            report = db.scalar(select(ReportRecord))
            snapshot_before = report.snapshot_json
            work.description = "Changed after finalisation"
            db.commit()
        saved = client.get(f"/reports/{report.id}")
        assert "Cleared blocked roadside drainage" in saved.text
        assert "Complete the remaining twenty metres" in saved.text
        assert "Makina Ward Officer" in saved.text
        with SessionLocal() as db:
            assert db.scalar(select(WorkPhoto))
        csv_response = client.get(f"/reports/{report.id}.csv")
        assert csv_response.status_code == 200
        assert "Employee ID" in csv_response.text
        with SessionLocal() as db:
            assert db.get(ReportRecord, report.id).snapshot_json == snapshot_before


def test_admin_can_create_user_and_import_staff_excel():
    with TestClient(app) as client:
        csrf = login(client)
        created = client.post(
            "/admin/users",
            data={"display_name": "Kibra Reviewer", "email": "reviewer@example.go.ke", "role": "subcounty_reviewer", "password": "SecurePass123!", "csrf_token": csrf},
            follow_redirects=False,
        )
        assert created.status_code == 303
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Names", "Phone Numbers", "Pay Roll Numbers", "Status", "Residence"])
        sheet.append(["Jane Example", "0711111111", "NCC-2001", "ANNUAL LEAVE", "Makina"])
        excel = BytesIO()
        workbook.save(excel)
        imported = client.post(
            "/employees/import",
            data={"csrf_token": csrf},
            files={"roster_file": ("staff.xlsx", excel.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            follow_redirects=False,
        )
        assert imported.status_code == 303
        with SessionLocal() as db:
            assert db.scalar(select(User).where(User.email == "reviewer@example.go.ke"))
            employee = db.scalar(select(Employee).where(Employee.employee_number == "NCC-2001"))
            employee_id = employee.id
            assert employee.profile.residence == "Makina"
            assert employee.profile.roster_status == "annual_leave"
            roster_row = next(row for row in daily_roster(db, today()) if row["employee"].id == employee.id)
            assert roster_row["status"] == "leave"
        edited = client.post(
            f"/employees/{employee_id}/edit",
            data={"full_name": "Jane Wanjiku", "employee_number": "NCC-2001", "phone": "0711111111", "residence": "Laini Saba", "roster_status": "on_duty", "csrf_token": csrf},
            follow_redirects=False,
        )
        assert edited.status_code == 303
        deactivated = client.post(f"/employees/{employee_id}/status", data={"active": "false", "csrf_token": csrf}, follow_redirects=False)
        assert deactivated.status_code == 303
        with SessionLocal() as db:
            employee = db.get(Employee, employee_id)
            assert employee.full_name == "Jane Wanjiku"
            assert employee.profile.residence == "Laini Saba"
            assert employee.active is False


def test_medical_document_is_private_and_reminders_are_idempotent():
    with TestClient(app) as client:
        csrf = login(client)
        with SessionLocal() as db:
            employee = db.scalar(select(Employee).where(Employee.employee_number == "NCC-1042"))
        start = today() + timedelta(days=30)
        response = client.post(
            "/absences",
            data={"employee_id": employee.id, "kind": "sick_off", "start_date": start.isoformat(), "end_date": start.isoformat(), "return_date": (start + timedelta(days=1)).isoformat(), "reason": "Medical rest prescribed", "csrf_token": csrf},
            files={"medical_document": ("note.pdf", b"%PDF-1.4\nmedical test", "application/pdf")},
            follow_redirects=False,
        )
        assert response.status_code == 303
        with SessionLocal() as db:
            document = db.scalar(select(Document))
            request = db.scalar(select(AbsenceRequest))
            request.kind = "annual_leave"
            db.commit()
            assert process_leave_reminders(db) == 1
            assert process_leave_reminders(db) == 0
            assert len(db.scalars(select(ReminderDelivery)).all()) == 1
            document_id = document.id
        anonymous = TestClient(app)
        assert anonymous.get(f"/documents/{document_id}/download").status_code == 401
        download = client.get(f"/documents/{document_id}/download")
        assert download.status_code == 200
        assert download.content.startswith(b"%PDF")
