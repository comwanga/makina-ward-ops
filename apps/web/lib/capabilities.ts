import type { CapabilityCode } from "@ward-ops/contracts";

export interface NavigationItem {
  href: string;
  label: string;
  capability?: CapabilityCode;
}

export const NAV_ITEMS: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/staff", label: "Staff", capability: "STAFF_READ" },
  { href: "/attendance", label: "Attendance", capability: "ATTENDANCE_READ" },
  { href: "/absences", label: "Absences", capability: "ABSENCE_READ" },
  { href: "/worklogs", label: "Work logs", capability: "WORK_READ" },
  { href: "/access-requests", label: "Access", capability: "USERS_MANAGE" },
  { href: "/reports", label: "Reports", capability: "REPORTS_READ" },
  { href: "/audit", label: "Audit", capability: "AUDIT_READ" },
];

export function hasCapability(capabilities: readonly string[], capability?: string): boolean {
  return !capability || capabilities.includes(capability);
}

export function visibleNavigation(capabilities: readonly string[]): NavigationItem[] {
  return NAV_ITEMS.filter((item) => hasCapability(capabilities, item.capability));
}
