import csv
import io
import re

from openpyxl import load_workbook


HEADER_ALIASES = {
    "employee_number": {"payroll number", "payroll numbers", "pay roll number", "pay roll numbers", "payroll no", "payroll id", "employee id", "user id", "staff id"},
    "full_name": {"name", "names", "full name", "staff name", "employee name"},
    "phone": {"phone", "phone number", "phone numbers", "mobile", "mobile number", "telephone"},
    "status": {"status", "duty status", "staff status"},
    "residence": {"residence", "residential area", "estate", "area"},
    "role": {"role", "designation", "job title"},
    "email": {"email", "email address"},
}


def normalize_header(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", " "))


def canonical_headers(values: list[object]) -> list[str | None]:
    headers = []
    for value in values:
        normalized = normalize_header(value)
        headers.append(next((field for field, aliases in HEADER_ALIASES.items() if normalized == field.replace("_", " ") or normalized in aliases), None))
    return headers


def text_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def parse_roster(content: bytes, filename: str) -> list[dict[str, str]]:
    if filename.lower().endswith(".xlsx"):
        try:
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception as exc:
            raise ValueError("Excel file is damaged or is not a valid .xlsx workbook") from exc
        sheet = workbook.active
        values = sheet.iter_rows(values_only=True)
        try:
            headers = canonical_headers(list(next(values)))
        except StopIteration:
            return []
        rows = [{header: text_value(value) for header, value in zip(headers, row) if header} for row in values]
        workbook.close()
    elif filename.lower().endswith(".csv"):
        decoded = content.decode("utf-8-sig")
        reader = csv.reader(decoded.splitlines())
        try:
            headers = canonical_headers(next(reader))
        except StopIteration:
            return []
        rows = [{header: text_value(value) for header, value in zip(headers, row) if header} for row in reader]
    else:
        raise ValueError("Roster must be an Excel .xlsx or CSV file")
    required = {"employee_number", "full_name", "phone", "status", "residence"}
    if not required.issubset({header for header in headers if header}):
        raise ValueError("Roster requires name, phone, payroll/employee ID, status and residence columns")
    return [row for row in rows if any(row.values())]


def normalize_roster_status(value: str) -> str:
    normalized = normalize_header(value)
    if normalized in {"on duty", "duty", "active", "present"}:
        return "on_duty"
    if normalized in {"annual leave", "on leave", "leave"}:
        return "annual_leave"
    raise ValueError(f"Unsupported staff status: {value}")
