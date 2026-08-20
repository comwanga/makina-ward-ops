"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { visibleNavigation } from "@/lib/capabilities";
import { AuthUser, fetchMe, logout } from "@/lib/api";

export function DashNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<(AuthUser & { capabilities: string[] }) | null>(null);

  useEffect(() => {
    let active = true;
    void fetchMe()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function onLogout() {
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  if (!user) return <span className="nav-loading" aria-hidden="true" />;

  return (
    <div className="dash-navigation">
      <nav className="dash-nav" aria-label="Primary">
        {visibleNavigation(user.capabilities).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="account-menu" aria-label="Account controls">
        <Link href="/account/password" title={user.email}>
          {user.displayName}
        </Link>
        <button type="button" className="link-btn" onClick={() => void onLogout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
