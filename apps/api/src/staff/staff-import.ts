import ExcelJS from "exceljs";

const HEADER_ALIASES: Record<string, Set<string>> = {
  employeeNumber: new Set([
    "employee id",
    "employee number",
    "payroll id",
    "payroll no",
    "payroll number",
    "staff id",
    "user id",
  ]),
  fullName: new Set(["employee name", "full name", "name", "names", "staff name"]),
  phone: new Set(["contact", "mobile", "mobile number", "phone", "phone number", "telephone"]),
  rosterStatus: new Set(["duty status", "staff status", "status"]),
  residence: new Set(["area", "estate", "residence", "residential area"]),
  designation: new Set(["designation", "job title", "role"]),
  email: new Set(["email", "email address"]),
};

export interface ParsedStaffImportRow {
  rowNumber: number;
  value: Record<string, string>;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalHeader(value: string): string | null {
  const normalized = normalizeHeader(value);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.has(normalized)) return key;
  }
  return null;
}

function parseCsv(content: Buffer): string[][] {
  const text = content.toString("utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function locateHeaders(rows: string[][]): { index: number; headers: Array<string | null> } {
  const required = new Set(["employeeNumber", "fullName", "phone"]);
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const headers = rows[index].map(canonicalHeader);
    const recognized = new Set(headers.filter((header): header is string => Boolean(header)));
    if ([...required].every((header) => recognized.has(header))) return { index, headers };
  }
  throw new Error("Could not locate headers for employee ID, full name and phone");
}

function normalizeStatus(value: string): string {
  const status = normalizeHeader(value);
  if (!status || ["active", "duty", "on duty", "present"].includes(status)) return "ON_DUTY";
  if (["annual leave", "leave", "on leave"].includes(status)) return "ANNUAL_LEAVE";
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

export async function parseStaffImport(
  content: Buffer,
  filename: string,
): Promise<ParsedStaffImportRow[]> {
  let rows: string[][];
  if (filename.toLowerCase().endsWith(".csv")) {
    rows = parseCsv(content);
  } else if (filename.toLowerCase().endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Uint8Array.from(content).buffer);
    } catch {
      throw new Error("Excel file is damaged or is not a valid .xlsx workbook");
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let column = 1; column <= row.cellCount; column += 1) {
        values.push(row.getCell(column).text.trim());
      }
      rows.push(values);
    });
  } else {
    throw new Error("Roster must be an Excel .xlsx or CSV file");
  }

  if (rows.length === 0) return [];
  const located = locateHeaders(rows);
  return rows.slice(located.index + 1).flatMap((row, offset) => {
    const value: Record<string, string> = {};
    located.headers.forEach((header, index) => {
      const cell = row[index]?.trim() ?? "";
      if (header && (cell || ["employeeNumber", "fullName", "phone", "rosterStatus"].includes(header))) {
        value[header] = cell;
      }
    });
    if (!Object.values(value).some(Boolean)) return [];
    if (value.rosterStatus !== undefined) value.rosterStatus = normalizeStatus(value.rosterStatus);
    return [{ rowNumber: located.index + offset + 2, value }];
  });
}
