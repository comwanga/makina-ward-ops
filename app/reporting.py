import json
from datetime import date, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import AttendanceSession, WorkLog
from .services import daily_roster


STATUSES = ("present", "late", "absent", "off_duty", "leave", "sick_off", "official_duty")


def date_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def build_snapshot(db: Session, start: date, end: date) -> dict:
    if end < start or (end - start).days > 366:
        raise ValueError("Report period must be between 1 and 367 days")
    days = []
    totals = {status: 0 for status in STATUSES}
    for work_date in date_range(start, end):
        session = db.scalar(
            select(AttendanceSession)
            .where(AttendanceSession.work_date == work_date)
            .order_by(AttendanceSession.created_at.desc())
        )
        if not session and work_date.weekday() >= 5:
            continue
        roster = daily_roster(db, work_date)
        rows = []
        for item in roster:
            totals[item["status"]] = totals.get(item["status"], 0) + 1
            rows.append(
                {
                    "employee_number": item["employee"].employee_number,
                    "full_name": item["employee"].full_name,
                    "role": item["employee"].role,
                    "status": item["status"],
                    "detail": item["detail"],
                }
            )
        days.append(
            {
                "date": work_date.isoformat(),
                "activity": session.activity if session else "No attendance session",
                "location": session.location if session else "Makina Ward",
                "roster": rows,
            }
        )

    work_logs = db.scalars(
        select(WorkLog)
        .where(WorkLog.work_date >= start, WorkLog.work_date <= end, WorkLog.status == "approved")
        .order_by(WorkLog.work_date)
    ).all()
    work = [
        {
            "date": item.work_date.isoformat(),
            "activity": item.activity,
            "location": item.location,
            "description": item.description,
            "quantity": item.quantity,
            "unit": item.unit,
            "staff_count": item.staff_count,
            "challenges": item.challenges,
            "completion_status": item.detail.completion_status if item.detail else "complete",
            "outstanding_work": item.detail.outstanding_work if item.detail else None,
            "photos": [{"id": photo.id, "caption": photo.caption, "sha256": photo.sha256} for photo in item.photos],
        }
        for item in work_logs
    ]
    return {"start_date": start.isoformat(), "end_date": end.isoformat(), "totals": totals, "days": days, "work_logs": work}


def deterministic_narrative(snapshot: dict) -> str:
    totals = snapshot["totals"]
    work = snapshot["work_logs"]
    activities = sorted({item["activity"] for item in work})
    output_parts = [
        f"{item['quantity']:g} {item['unit']} ({item['activity']})"
        for item in work
        if item["quantity"] is not None and item["unit"]
    ]
    text = (
        f"During the reporting period, {len(work)} approved work activities were recorded. "
        f"Attendance records contained {totals.get('present', 0)} present and {totals.get('late', 0)} late entries, "
        f"with {totals.get('absent', 0)} absence entries requiring or having received follow-up."
    )
    if activities:
        text += f" Activities covered {', '.join(activities)}."
    if output_parts:
        text += f" Recorded outputs included {', '.join(output_parts)}."
    return text


def deterministic_recommendations(snapshot: dict) -> str:
    incomplete = [item["activity"] for item in snapshot["work_logs"] if item.get("completion_status") == "incomplete"]
    if incomplete:
        return f"Prioritise follow-up and completion of: {', '.join(sorted(set(incomplete)))}. Continue monitoring attendance and documented field outputs."
    return "Sustain the completed activities, continue routine monitoring, and address emerging operational challenges promptly."


def structured_ai_payload(snapshot: dict) -> dict:
    approved_work = [
        {
            "date": item["date"],
            "activity": item["activity"],
            "location": item["location"],
            "quantity": item["quantity"],
            "unit": item["unit"],
            "staff_count": item["staff_count"],
            "completion_status": item.get("completion_status", "complete"),
        }
        for item in snapshot["work_logs"]
    ]
    return {
        "period": [snapshot["start_date"], snapshot["end_date"]],
        "attendance_totals": snapshot["totals"],
        "approved_work": approved_work,
    }


def ai_narrative(snapshot: dict) -> str:
    fallback = deterministic_narrative(snapshot)
    if not settings.ai_enabled or not settings.ai_api_key:
        return fallback
    safe_payload = structured_ai_payload(snapshot)
    try:
        response = httpx.post(
            f"{settings.ai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.ai_api_key}"},
            json={
                "model": settings.ai_model,
                "temperature": 0.1,
                "max_tokens": 600,
                "messages": [
                    {"role": "system", "content": "Draft a concise formal Nairobi ward environment operations report using only supplied facts. Never invent names, quantities, places, activities, causes or recommendations. Clearly identify missing information instead of guessing."},
                    {"role": "user", "content": json.dumps(safe_payload)},
                ],
            },
            timeout=20,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"].strip()
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return fallback
