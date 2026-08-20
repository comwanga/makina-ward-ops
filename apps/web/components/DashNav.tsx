"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/staff", label: "Staff" },
  { href: "/attendance", label: "Attendance" },
  { href: "/absences", label: "Absences" },
  { href: "/worklogs", label: "Work logs" },
  { href: "/access-requests", label: "Access" },
  { href: "/reports", label: "Reports" },
  { href: "/audit", label: "Audit" },
];

export function DashNav() {
  const pathname = usePathname();
  return (
    <nav className="dash-nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}