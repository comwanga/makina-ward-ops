"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { ApiError, AuditEvent, fetchMe, listAudit } from "@/lib/api";

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
}

export default function AuditPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (!me) {
        router.push("/login");
        return;
      }
      if (me.mustChangePassword) {
        router.push("/account/password");
        return;
      }
      const result = await listAudit({ page: 1, pageSize: 100 });
      setEvents(result.items);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Unable to load audit history");
      }
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} />
        <div className="dash-title">
          <p className="eyebrow">AUDIT HISTORY</p>
          <h1>Audit</h1>
        </div>
        <nav className="dash-nav">
          <a href="/">Home</a>
          <a href="/staff">Staff</a>
          <a href="/attendance">Attendance</a>
          <a href="/absences">Absences</a>
          <a href="/worklogs">Work logs</a>
          <a href="/audit" aria-current="page">Audit</a>
        </nav>
      </header>

      <section className="panel">
        <h2>Recent activity ({total} total)</h2>
        {error && <p className="form-error">{error}</p>}
        {events.length === 0 ? (
          <p className="empty">No audit events visible in your scope.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Target</th>
                <th>Scope</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatWhen(event.occurredAt)}</td>
                  <td>{event.action}</td>
                  <td>{event.targetType}{event.targetId ? ` · ${event.targetId}` : ""}</td>
                  <td>{event.scopeType ? `${event.scopeType} · ${event.scopeId}` : "global"}</td>
                  <td>{event.details ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
