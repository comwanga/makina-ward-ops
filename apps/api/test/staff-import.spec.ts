import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseStaffImport } from "../src/staff/staff-import";

describe("staff roster parser", () => {
  it("parses CSV header aliases and quoted values", async () => {
    const rows = await parseStaffImport(
      Buffer.from(
        "Employee ID,Staff Name,Phone Number,Status,Residence\n20250102001,\"Amina, Hassan\",0711222001,On leave,Makina",
      ),
      "roster.csv",
    );
    expect(rows).toEqual([
      {
        rowNumber: 2,
        value: {
          employeeNumber: "20250102001",
          fullName: "Amina, Hassan",
          phone: "0711222001",
          rosterStatus: "ANNUAL_LEAVE",
          residence: "Makina",
        },
      },
    ]);
  });

  it("parses XLSX workbooks", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Roster");
    sheet.addRow(["Payroll Number", "Name", "Mobile", "Duty Status"]);
    sheet.addRow([20250102002, "Brian Otieno", "0711222002", "Active"]);
    const data = await workbook.xlsx.writeBuffer();

    const rows = await parseStaffImport(Buffer.from(new Uint8Array(data)), "roster.xlsx");
    expect(rows[0].value).toMatchObject({
      employeeNumber: "20250102002",
      fullName: "Brian Otieno",
      phone: "0711222002",
      rosterStatus: "ON_DUTY",
    });
  });

  it("recognizes county payroll headers and normalizes nine-digit Kenyan phones", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Employees");
    sheet.addRow(["name", "phone", "Payroll/Employee ID", "status", "residence"]);
    sheet.addRow(["ALFRED ZECKY OYOO", 704722195, 20230228567, "ON DUTY", "LANGATA"]);
    sheet.addRow(["PERIS NJOROGE", 705302543, 20240192904, "ANNUAL LEAVE", "KAWANGWARE"]);
    const data = await workbook.xlsx.writeBuffer();

    const rows = await parseStaffImport(Buffer.from(new Uint8Array(data)), "employees.xlsx");
    expect(rows.map((row) => row.value)).toEqual([
      {
        fullName: "ALFRED ZECKY OYOO",
        phone: "0704722195",
        employeeNumber: "20230228567",
        rosterStatus: "ON_DUTY",
        residence: "LANGATA",
      },
      {
        fullName: "PERIS NJOROGE",
        phone: "0705302543",
        employeeNumber: "20240192904",
        rosterStatus: "ANNUAL_LEAVE",
        residence: "KAWANGWARE",
      },
    ]);
  });
});
