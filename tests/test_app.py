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
from app.auth import SCOPES, has_scope
from app.models import AccessRequest, AbsenceRequest, Attendance, Document, Employee, ReminderDelivery, ReportRecord, User, UserSession, WorkLog, WorkLogOperations, WorkPhoto, WorkPhotoStage
from app.notifications import process_leave_reminders
from app.reporting import sample_period_photos, structured_ai_payload
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
                    "number_of_trips": 3,
                    "staff_count": 6,
                    "challenges": "Medical details must remain private",
                }
            ],
        }
    )
    encoded = str(payload)
    assert "Jane" not in encoded
    assert "Medical details" not in encoded
    assert payload["approved_work"][0]["number_of_trips"] == 3


def test_weekly_and_monthly_reports_sample_photos_by_stage():
    work = [{"photos": [{"id": index, "stage": stage} for index in range(offset, offset + 6)]} for stage, offset in (("before", 1), ("during", 7), ("after", 13))]
    daily = [{"photos": [dict(photo) for photo in item["photos"]]} for item in work]
    sample_period_photos(daily, "daily")
    assert sum(len(item["photos"]) for item in daily) == 18
    sample_period_photos(work, "weekly")
    assert sum(len(item["photos"]) for item in work) == 12
    assert all(len(item["photos"]) == 4 for item in work)


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
        with SessionLocal() as db:
            visitor = db.scalar(select(User).where(User.email == "visitor@example.go.ke"))
            assert visitor.permissions == "attendance,reports"
            assert has_scope(visitor, "attendance")
            assert not has_scope(visitor, "staff_register")
        forbidden = visitor_client.post(
            "/sessions",
            data={"activity": "Not allowed", "location": "Makina", "duration": "60", "csrf_token": "irrelevant"},
        )
        assert forbidden.status_code == 403


def test_scoped_denial_request_and_revocation():
    with TestClient(app) as owner_client:
        csrf = login(owner_client)
        registration = owner_client.get("/register")
        register_csrf = re.search(r'name="register_csrf" value="([^"]+)"', registration.text).group(1)
        owner_client.post(
            "/register",
            data={"display_name": "Benchmark Visitor", "email": "bench@example.go.ke", "password": "BenchPassword123!", "reason": "I want to benchmark ward reporting operations", "register_csrf": register_csrf},
        )
        with SessionLocal() as db:
            access_request = db.scalar(select(AccessRequest).where(AccessRequest.email == "bench@example.go.ke"))
        approved = owner_client.post(
            f"/admin/access-requests/{access_request.id}/approve",
            data={"csrf_token": csrf, "permissions": ["attendance", "reports"]},
            follow_redirects=False,
        )
        assert approved.status_code == 303

        visitor = TestClient(app)
        assert visitor.post("/login", data={"email": "bench@example.go.ke", "password": "BenchPassword123!"}, follow_redirects=False).status_code == 303

        denied = visitor.get("/employees")
        assert denied.status_code == 200
        assert "Access denied" in denied.text
        assert "Staff register" in denied.text
        denied_csrf = re.search(r'name="csrf_token" value="([^"]+)"', denied.text).group(1)
        requested_upgrade = visitor.post(
            "/access/request",
            data={"csrf_token": denied_csrf, "scope": "staff_register", "reason": "Reviewing the staff register while benchmarking county operations"},
        )
        assert "sent to the system owner" in requested_upgrade.text
        with SessionLocal() as db:
            upgrade = db.scalar(select(AccessRequest).where(AccessRequest.target_user_id.is_not(None), AccessRequest.status == "pending"))
            assert upgrade.requested_scope == "staff_register"
            assert upgrade.target_user_id == db.scalar(select(User).where(User.email == "bench@example.go.ke")).id

        approved_upgrade = owner_client.post(
            f"/admin/access-requests/{upgrade.id}/approve",
            data={"csrf_token": csrf, "permissions": ["attendance", "reports", "staff_register"]},
            follow_redirects=False,
        )
        assert approved_upgrade.status_code == 303
        assert "Amina Wanjiku" in visitor.get("/employees").text

        with SessionLocal() as db:
            bench_user = db.scalar(select(User).where(User.email == "bench@example.go.ke"))
            assert bench_user.active is True
            assert "staff_register" in bench_user.permissions
            bench_id = bench_user.id
        revoked = owner_client.post(
            f"/admin/users/{bench_id}/status",
            data={"csrf_token": csrf, "active": "false"},
            follow_redirects=False,
        )
        assert revoked.status_code == 303
        assert visitor.get("/", follow_redirects=False).status_code == 303
        with SessionLocal() as db:
            assert db.scalar(select(User).where(User.id == bench_id)).active is False
            assert db.scalar(select(UserSession).where(UserSession.user_id == bench_id, UserSession.revoked_at.is_(None))) is None
        restored = owner_client.post(
            f"/admin/users/{bench_id}/status",
            data={"csrf_token": csrf, "active": "true"},
            follow_redirects=False,
        )
        assert restored.status_code == 303
        with SessionLocal() as db:
            assert db.scalar(select(User).where(User.id == bench_id)).active is True


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
        assert 'placeholder="20230464669"' in checkin_page.text
        assert "phone_last_four" not in checkin_page.text
        public_csrf = re.search(r'name="public_csrf" value="([^"]+)"', checkin_page.text).group(1)
        checked = client.post(
            f"/check-in/{token}",
            data={"employee_number": "20230464669", "public_csrf": public_csrf},
        )
        assert "Attendance confirmed" in checked.text
        duplicate = client.post(
            f"/check-in/{token}",
            data={"employee_number": "20230464669", "public_csrf": public_csrf},
        )
        assert "already been recorded" in duplicate.text
        with SessionLocal() as db:
            records = db.scalars(select(Attendance)).all()
            assert len(records) == 1


def test_invalid_employee_id_format_is_rejected():
    with TestClient(app) as client:
        csrf = login(client)
        token = create_attendance_session(client, csrf)
        checkin_page = client.get(f"/check-in/{token}")
        public_csrf = re.search(r'name="public_csrf" value="([^"]+)"', checkin_page.text).group(1)
        response = client.post(
            f"/check-in/{token}",
            data={"employee_number": "NCC-1042", "public_csrf": public_csrf},
        )
        assert "11-digit Employee ID" in response.text
        unknown = client.post(
            f"/check-in/{token}",
            data={"employee_number": "20269999999", "public_csrf": public_csrf},
        )
        assert "does not match an active employee" in unknown.text


def test_manual_exception_only_updates_staff_without_qr_checkin():
    with TestClient(app) as client:
        csrf = login(client)
        create_attendance_session(client, csrf)
        dashboard = client.get("/")
        assert 'class="status-edit"' in dashboard.text
        assert '<option value="sick_off">Sick off</option>' in dashboard.text
        with SessionLocal() as db:
            employee = db.scalar(select(Employee).where(Employee.employee_number == "20230464669"))
            employee_id = employee.id
        updated = client.post(
            "/attendance/supervised",
            data={"employee_id": employee_id, "attendance_status": "off_duty", "reason": "Approved weekly off duty", "csrf_token": csrf},
            follow_redirects=False,
        )
        assert updated.status_code == 303
        with SessionLocal() as db:
            row = next(item for item in daily_roster(db, today()) if item["employee"].id == employee_id)
            assert row["status"] == "off_duty"
            assert row["manual_editable"] is False
        duplicate = client.post(
            "/attendance/supervised",
            data={"employee_id": employee_id, "attendance_status": "absent", "reason": "Should not replace record", "csrf_token": csrf},
        )
        assert duplicate.status_code == 409
        history = client.get(f"/attendance/history?report_date={today().isoformat()}")
        assert history.status_code == 200
        assert "off duty" in history.text
        assert "Generate daily staff report" in history.text


def test_approved_sick_off_replaces_manual_absence():
    with TestClient(app) as client:
        csrf = login(client)
        create_attendance_session(client, csrf)
        with SessionLocal() as db:
            employee = db.scalar(select(Employee).where(Employee.employee_number == "20242535656"))
            employee_id = employee.id

        manual = client.post(
            "/attendance/supervised",
            data={"employee_id": employee_id, "attendance_status": "absent", "reason": "Awaiting sick-off documentation", "csrf_token": csrf},
            follow_redirects=False,
        )
        assert manual.status_code == 303
        requested = client.post(
            "/absences",
            data={
                "employee_id": employee_id,
                "kind": "sick_off",
                "start_date": today().isoformat(),
                "end_date": today().isoformat(),
                "return_date": (today() + timedelta(days=1)).isoformat(),
                "reason": "Medical sick-off documentation received",
                "csrf_token": csrf,
            },
            follow_redirects=False,
        )
        assert requested.status_code == 303
        with SessionLocal() as db:
            absence_request = db.scalar(select(AbsenceRequest))
        approved = client.post(
            f"/absences/{absence_request.id}/approve",
            data={"csrf_token": csrf, "review_note": "Documentation verified"},
            follow_redirects=False,
        )
        assert approved.status_code == 303
        with SessionLocal() as db:
            row = next(item for item in daily_roster(db, today()) if item["employee"].id == employee_id)
            assert row["status"] == "sick_off"
            assert row["manual_editable"] is False


def test_manual_sick_off_status_is_supported():
    with TestClient(app) as client:
        csrf = login(client)
        create_attendance_session(client, csrf)
        with SessionLocal() as db:
            employee_id = db.scalar(select(Employee).where(Employee.employee_number == "20230464669")).id
        response = client.post(
            "/attendance/supervised",
            data={"employee_id": employee_id, "attendance_status": "sick_off", "reason": "Reported unwell before work", "csrf_token": csrf},
            follow_redirects=False,
        )
        assert response.status_code == 303
        with SessionLocal() as db:
            row = next(item for item in daily_roster(db, today()) if item["employee"].id == employee_id)
            assert row["status"] == "sick_off"


def test_approved_leave_reconciles_roster():
    with TestClient(app) as client:
        csrf = login(client)
        with SessionLocal() as db:
            employee = db.scalar(select(Employee).where(Employee.employee_number == "20242535656"))
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
        work_page = client.get("/work-logs")
        assert 'name="before_photos" accept="image/*" multiple' in work_page.text
        assert 'name="during_photos" accept="image/*" multiple' in work_page.text
        assert 'name="after_photos" accept="image/*" multiple' in work_page.text
        assert 'placeholder="T-161"' in work_page.text
        assert 'placeholder="BH13"' in work_page.text
        assert 'name="unit"' not in work_page.text
        assert "capture=" not in work_page.text
        assert "WhatsApp photos" not in work_page.text
        work_response = client.post(
            "/work-logs",
            data={
                "work_date": today().isoformat(),
                "activity": "Drainage clearing",
                "location": "Makina Market",
                "areas_roads": "Mashinani Road and Makina Market access road",
                "description": "Cleared blocked roadside drainage",
                "number_of_trips": "3",
                "waste_transfer_involved": "true",
                "truck_id": "T-161",
                "backhoe_id": "BH13",
                "staff_count": "6",
                "challenges": "Heavy silt",
                "cleanup_done": "true",
                "cleanup_stakeholders": "Makina market traders",
                "climate_team_count": "8",
                "completion_status": "incomplete",
                "outstanding_work": "Complete the final twenty metres",
                "photo_caption": "Drainage cleared near the market",
                "csrf_token": csrf,
            },
            files=[
                ("before_photos", ("before.jpg", b"\xff\xd8\xff\xe0before-photo", "image/jpeg")),
                ("during_photos", ("during.jpg", b"\xff\xd8\xff\xe0during-photo", "image/jpeg")),
                ("after_photos", ("after.jpg", b"\xff\xd8\xff\xe0after-photo", "image/jpeg")),
            ],
            follow_redirects=False,
        )
        assert work_response.status_code == 303
        with SessionLocal() as db:
            work = db.scalar(select(WorkLog))
            operations = db.scalar(select(WorkLogOperations))
            assert operations.areas_roads == "Mashinani Road and Makina Market access road"
            assert operations.number_of_trips == 3
            assert operations.truck_id == "T-161"
            assert operations.backhoe_id == "BH13"
            assert operations.cleanup_stakeholders == "Makina market traders"
            assert operations.climate_team_count == 8
            assert {item.stage for item in db.scalars(select(WorkPhotoStage)).all()} == {"before", "during", "after"}
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
        assert "Mashinani Road and Makina Market access road" in saved.text
        assert "T-161" in saved.text
        assert "BH13" in saved.text
        assert "Makina market traders" in saved.text
        assert "Makina Ward Officer" in saved.text
        with SessionLocal() as db:
            assert db.scalar(select(WorkPhoto))
        csv_response = client.get(f"/reports/{report.id}.csv")
        assert csv_response.status_code == 200
        assert "Employee ID" in csv_response.text
        with SessionLocal() as db:
            assert db.get(ReportRecord, report.id).snapshot_json == snapshot_before


def test_work_log_enforces_equipment_cleanup_and_photo_rules():
    with TestClient(app) as client:
        csrf = login(client)
        base = {
            "work_date": today().isoformat(),
            "activity": "Waste removal",
            "location": "Makina Ward",
            "areas_roads": "Mashinani Road",
            "description": "Removed accumulated waste",
            "number_of_trips": "2",
            "staff_count": "4",
            "completion_status": "complete",
            "csrf_token": csrf,
        }
        bad_equipment = client.post(
            "/work-logs",
            data={**base, "waste_transfer_involved": "true", "truck_id": "161"},
        )
        assert bad_equipment.status_code == 400
        assert "format T-161" in bad_equipment.text
        missing_cleanup_team = client.post(
            "/work-logs",
            data={**base, "cleanup_done": "true"},
        )
        assert missing_cleanup_team.status_code == 400
        assert "cleanup stakeholders" in missing_cleanup_team.text
        too_many_photos = client.post(
            "/work-logs",
            data=base,
            files=[("before_photos", (f"before-{index}.jpg", b"\xff\xd8\xff\xe0photo", "image/jpeg")) for index in range(5)],
        )
        assert too_many_photos.status_code == 400
        assert "at most 4 before" in too_many_photos.text


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
        sheet.append(["MAKINA WARD GREEN ARMY STAFF RETURN"])
        sheet.append(["Updated staff list"])
        sheet.append(["Employee Name(s)", "Mobile/Tel. No.", "Payroll Number / Employee ID / User ID", "Duty Status", "Area of Residence"])
        sheet.append(["Jane Example", "0711111111", "20231234567", "ANNUAL LEAVE", "Makina"])
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
            employee = db.scalar(select(Employee).where(Employee.employee_number == "20231234567"))
            employee_id = employee.id
            assert employee.profile.residence == "Makina"
            assert employee.profile.roster_status == "annual_leave"
            roster_row = next(row for row in daily_roster(db, today()) if row["employee"].id == employee.id)
            assert roster_row["status"] == "leave"
        edited = client.post(
            f"/employees/{employee_id}/edit",
            data={"full_name": "Jane Wanjiku", "employee_number": "20231234567", "phone": "0711111111", "residence": "Laini Saba", "roster_status": "on_duty", "csrf_token": csrf},
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
            employee = db.scalar(select(Employee).where(Employee.employee_number == "20230464669"))
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
