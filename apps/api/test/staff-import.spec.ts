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
});
