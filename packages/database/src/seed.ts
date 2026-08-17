import { CapabilityCode, PrismaClient, RoleCode } from "@prisma/client";

const prisma = new PrismaClient();

const CAPABILITIES: Array<{ code: CapabilityCode; name: string }> = [
  { code: "STAFF_READ", name: "View staff register" },
  { code: "STAFF_MANAGE", name: "Manage staff" },
  { code: "ATTENDANCE_READ", name: "View attendance" },
  { code: "ATTENDANCE_MANAGE", name: "Manage attendance" },
  { code: "WORK_READ", name: "View work logs" },
  { code: "WORK_CREATE", name: "Create work logs" },
  { code: "WORK_REVIEW", name: "Review work logs" },
  { code: "ABSENCE_READ", name: "View absences" },
  { code: "ABSENCE_MANAGE", name: "Manage absences" },
  { code: "ABSENCE_REVIEW", name: "Review absences" },
  { code: "MEDICAL_READ", name: "Access medical documents" },
  { code: "REPORTS_READ", name: "View reports" },
  { code: "REPORTS_FINALIZE", name: "Finalize reports" },
  { code: "AUDIT_READ", name: "View audit history" },
  { code: "USERS_MANAGE", name: "Manage users" },
];

const ROLE_CAPABILITIES: Record<RoleCode, CapabilityCode[]> = {
  SYSTEM_ADMIN: CAPABILITIES.map((c) => c.code),
  WARD_OFFICER: [
    "STAFF_READ",
    "STAFF_MANAGE",
    "ATTENDANCE_READ",
    "ATTENDANCE_MANAGE",
    "WORK_READ",
    "WORK_CREATE",
    "ABSENCE_READ",
    "ABSENCE_MANAGE",
    "REPORTS_READ",
  ],
  SUBCOUNTY_REVIEWER: [
    "STAFF_READ",
    "ATTENDANCE_READ",
    "WORK_READ",
    "WORK_REVIEW",
    "ABSENCE_READ",
    "ABSENCE_REVIEW",
    "REPORTS_READ",
    "REPORTS_FINALIZE",
    "AUDIT_READ",
  ],
  HR_VIEWER: [
    "STAFF_READ",
    "ATTENDANCE_READ",
    "ABSENCE_READ",
    "ABSENCE_MANAGE",
    "ABSENCE_REVIEW",
    "MEDICAL_READ",
    "REPORTS_READ",
  ],
  // READ_ONLY mirrors the legacy "read-only benchmark" default grants.
  READ_ONLY: ["ATTENDANCE_READ", "REPORTS_READ"],
};

async function main() {
  const capabilityByCode = new Map<string, string>();
  for (const capability of CAPABILITIES) {
    const created = await prisma.capability.upsert({
      where: { code: capability.code },
      update: {},
      create: capability,
    });
    capabilityByCode.set(created.code, created.id);
  }

  for (const [roleCode, capabilityCodes] of Object.entries(ROLE_CAPABILITIES)) {
    const role = await prisma.role.upsert({
      where: { code: roleCode as RoleCode },
      update: {},
      create: { code: roleCode as RoleCode, name: roleCode.replace(/_/g, " ").toLowerCase() },
    });
    for (const capabilityCode of capabilityCodes) {
      const capabilityId = capabilityByCode.get(capabilityCode);
      if (!capabilityId) continue;
      await prisma.roleCapability.upsert({
        where: { roleId_capabilityId: { roleId: role.id, capabilityId } },
        update: {},
        create: { roleId: role.id, capabilityId },
      });
    }
  }

  const county = await prisma.county.upsert({
    where: { code: "NCC" },
    update: {},
    create: { code: "NCC", name: "Nairobi City County" },
  });

  const subcounty = await prisma.subcounty.upsert({
    where: { code: "KIBRA" },
    update: {},
    create: { code: "KIBRA", name: "Kibra", countyId: county.id },
  });

  await prisma.ward.upsert({
    where: { code: "MAKINA" },
    update: {},
    create: { code: "MAKINA", name: "Makina", subcountyId: subcounty.id },
  });

  console.log("Seed complete: capabilities, roles, county -> subcounty -> ward.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
