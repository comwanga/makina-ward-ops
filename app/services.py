from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Absence, AbsenceRequest, Attendance, Employee, PlannedLeave


NAIROBI = ZoneInfo("Africa/Nairobi")


def now() -> datetime:
    return datetime.now(NAIROBI).replace(tzinfo=None)


def today() -> date:
    return now().date()


def daily_roster(db: Session, work_date: date) -> list[dict]:
    employees = db.scalars(select(Employee).where(Employee.active.is_(True)).order_by(Employee.full_name)).all()
    attendance = {
        item.employee_id: item
        for item in db.scalars(select(Attendance).where(Attendance.work_date == work_date)).all()
    }
    legacy_absences = db.scalars(
        select(Absence).where(
            Absence.start_date <= work_date,
            Absence.end_date >= work_date,
            Absence.approval_status == "approved",
        )
    ).all()
    requests = db.scalars(
        select(AbsenceRequest).where(
            AbsenceRequest.start_date <= work_date,
            AbsenceRequest.end_date >= work_date,
            AbsenceRequest.status == "approved",
        )
    ).all()
    absence_by_employee = {item.employee_id: item for item in legacy_absences}
    absence_by_employee.update({item.employee_id: item for item in requests})

    rows = []
    for employee in employees:
        record = attendance.get(employee.id)
        absence = absence_by_employee.get(employee.id)
        if record:
            status = record.status
            detail = record.checked_at.strftime("%H:%M")
        elif absence:
            status = "sick_off" if absence.kind == "sick_off" else ("official_duty" if absence.kind == "official_duty" else "leave")
            detail = f"Returns {absence.return_date.strftime('%d %b')}"
        else:
            status = "absent"
            detail = "No check-in"
        rows.append({"employee": employee, "status": status, "detail": detail})
    return rows


def dashboard_data(db: Session, work_date: date) -> dict:
    roster = daily_roster(db, work_date)
    counts = {status: 0 for status in ("present", "late", "absent", "sick_off", "leave")}
    for row in roster:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    reminder_limit = work_date + timedelta(days=30)
    upcoming_legacy = db.scalars(
        select(PlannedLeave)
        .where(PlannedLeave.start_date >= work_date, PlannedLeave.start_date <= reminder_limit)
        .order_by(PlannedLeave.start_date)
    ).all()
    upcoming_requests = db.scalars(
        select(AbsenceRequest)
        .where(
            AbsenceRequest.kind != "sick_off",
            AbsenceRequest.status.in_(("planned", "submitted", "approved")),
            AbsenceRequest.start_date >= work_date,
            AbsenceRequest.start_date <= reminder_limit,
        )
        .order_by(AbsenceRequest.start_date)
    ).all()
    legacy_pending = db.scalar(select(func.count(Absence.id)).where(Absence.approval_status == "pending")) or 0
    request_pending = db.scalar(select(func.count(AbsenceRequest.id)).where(AbsenceRequest.status == "submitted")) or 0
    pending_absences = legacy_pending + request_pending
    return {
        "date": work_date.isoformat(),
        "display_date": work_date.strftime("%A, %d %B %Y"),
        "counts": counts,
        "total": len(roster),
        "roster": roster,
        "upcoming_leave": [*upcoming_legacy, *upcoming_requests],
        "pending_absences": pending_absences,
    }
