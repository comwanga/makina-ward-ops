"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import {
  ApiError,
  OrganisationCounty,
  Report,
  ReportKind,
  ReportPreview,
  ReportScopeType,
  downloadReportCsv,
  draftReportNarrative,
  fetchMe,
  fetchOrganisationTree,
  fetchReport,
  finalizeReport,
  listReports,
  previewReport,
} from "@/lib/api";

const KINDS: ReportKind[] = ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"];

function nairobiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface ScopeOption {
  scopeType: ReportScopeType;
  scopeId: string;
  label: string;
}

function flattenScopes(counties: OrganisationCounty[]): ScopeOption[] {
  const options: ScopeOption[] = [];
  for (const county of counties) {
    options.push({ scopeType: "COUNTY", scopeId: county.id, label: `${county.name} (County)` });
    for (const subcounty of county.subcounties) {
      options.push({
        scopeType: "SUBCOUNTY",
        scopeId: subcounty.id,
        label: `${subcounty.name} (Subcounty)`,
      });
      for (const ward of subcounty.wards) {
        options.push({ scopeType: "WARD", scopeId: ward.id, label: `${ward.name} (Ward)` });
      }
    }
  }
  return options;
}

export default function ReportsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ capabilities: string[] } | null>(null);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [form, setForm] = useState({
    scopeId: "",
    startDate: nairobiToday(),
    endDate: nairobiToday(),
    kind: "DAILY" as ReportKind,
    narrative: "",
    recommendations: "",
  });

  const can = (capability: string) => me?.capabilities.includes(capability) ?? false;

  const load = useCallback(async () => {
    try {
      const current = await fetchMe();
      if (!current) {
        router.push("/login");
        return;
      }
      if (current.mustChangePassword) {
        router.push("/account/password");
        return;
      }
      setMe(current);
      const counties = await fetchOrganisationTree();
      const options = flattenScopes(counties);
      setScopes(options);
      setForm((currentForm) => ({
        ...currentForm,
        scopeId: currentForm.scopeId || options[0]?.scopeId || "",
      }));
      setReports(await listReports());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Unable to load reports");
      }
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeOption = scopes.find((option) => option.scopeId === form.scopeId);
  const periodInput = {
    scopeType: (scopeOption?.scopeType ?? "WARD") as ReportScopeType,
    scopeId: form.scopeId,
    startDate: form.startDate,
    endDate: form.endDate,
    kind: form.kind,
  };

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const result = await previewReport(periodInput);
      setPreview(result);
      setForm((current) => ({
        ...current,
        narrative: result.narrative,
        recommendations: result.recommendations,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to build preview");
    }
  }

  async function onFinalize() {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await finalizeReport({
        ...periodInput,
        narrative: form.narrative,
        recommendations: form.recommendations,
      });
      setNotice(`Finalized ${created.title}.`);
      setSelected(created);
      setReports(await listReports());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to finalize report");
    } finally {
      setSubmitting(false);
    }
  }

  async function onAiDraft() {
    setError(null);
    setNotice(null);
    setDrafting(true);
    try {
      const draft = await draftReportNarrative(periodInput);
      setPreview(draft);
      setForm((current) => ({
        ...current,
        narrative: draft.narrative,
        recommendations: draft.recommendations,
      }));
      setNotice(
        draft.narrativeSource === "ai"
          ? "AI narrative draft generated."
          : "AI narrative unavailable — used deterministic fallback.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to draft narrative");
    } finally {
      setDrafting(false);
    }
  }

  async function onOpen(report: Report) {
    setError(null);
    try {
      setSelected(await fetchReport(report.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to open report");
    }
  }

  async function onCsv(report: Report) {
    setError(null);
    try {
      const blob = await downloadReportCsv(report.id);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `makina-${report.kind.toLowerCase()}-${report.periodStart}.csv`;
      link.click();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to export report");
    }
  }

  const snapshot = preview?.snapshot ?? selected?.snapshot ?? null;
  const narrative = selected ? selected.narrative : form.narrative;
  const recommendations = selected ? selected.recommendations : form.recommendations;

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} />
        <div className="dash-title">
          <p className="eyebrow">MAKINA WARD · REPORTS</p>
          <h1>Reports</h1>
        </div>
        <nav className="dash-nav">
          <a href="/">Home</a>
          <a href="/staff">Staff</a>
          <a href="/attendance">Attendance</a>
          <a href="/absences">Absences</a>
          <a href="/worklogs">Work logs</a>
          <a href="/reports" aria-current="page">Reports</a>
        </nav>
      </header>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-success">{notice}</p>}

      <section className="panel">
        <h2>Build a report</h2>
        <form className="grid-form" onSubmit={onPreview}>
          <label>
            Scope
            <select
              value={form.scopeId}
              onChange={(e) => setForm({ ...form, scopeId: e.target.value })}
              required
            >
              <option value="">Select scope…</option>
              {scopes.map((option) => (
                <option key={`${option.scopeType}-${option.scopeId}`} value={option.scopeId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period type
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as ReportKind })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.charAt(0) + kind.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              required
            />
          </label>
          <button type="submit">Preview report</button>
        </form>
      </section>

      {preview && !selected && (
        <section className="panel">
          <h2>Draft — {preview.title}</h2>
          <p className="muted-text">
            Period {formatDate(preview.snapshot.startDate)} –{" "}
            {formatDate(preview.snapshot.endDate)} · {preview.snapshot.scopeName}
          </p>
          <TotalsBar totals={preview.snapshot.totals} />
          <label>
            Narrative
            <textarea
              value={form.narrative}
              onChange={(e) => setForm({ ...form, narrative: e.target.value })}
              rows={4}
            />
          </label>
          {can("REPORTS_FINALIZE") && (
            <button
              type="button"
              className="link-btn"
              onClick={() => void onAiDraft()}
              disabled={drafting}
            >
              {drafting ? "Drafting…" : "Draft narrative with AI"}
            </button>
          )}
          <label>
            Recommendations
            <textarea
              value={form.recommendations}
              onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
              rows={3}
            />
          </label>
          {can("REPORTS_FINALIZE") && (
            <button onClick={() => void onFinalize()} disabled={submitting}>
              {submitting ? "Finalizing…" : "Finalize report"}
            </button>
          )}
        </section>
      )}

      {selected && snapshot && (
        <section className="panel">
          <h2>{selected.title}</h2>
          <p className="muted-text">
            <span className={`badge finalized`}>FINALIZED</span>{" "}
            {formatDate(snapshot.startDate)} – {formatDate(snapshot.endDate)} ·{" "}
            {snapshot.scopeName} · version {selected.version}
            {snapshot.signedBy ? ` · Signed by ${snapshot.signedBy} (${snapshot.signedTitle})` : ""}
          </p>
          <TotalsBar totals={snapshot.totals} />
          <p>
            <strong>Narrative</strong>
            <br />
            {narrative}
          </p>
          <p>
            <strong>Recommendations</strong>
            <br />
            {recommendations}
          </p>
          <div className="doc-actions">
            <button
              className="link-btn"
              onClick={() => {
                setSelected(null);
                setPreview(null);
              }}
            >
              ← Back
            </button>
            <button className="link-btn" onClick={() => window.print()}>
              Print / PDF
            </button>
            <button className="link-btn" onClick={() => void onCsv(selected)}>
              Export CSV
            </button>
          </div>
          <h3>Daily roster snapshot</h3>
          {snapshot.days.length === 0 ? (
            <p className="empty">No attendance days in this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ward</th>
                  <th>Activity</th>
                  <th>Location</th>
                  <th>Present</th>
                  <th>Late</th>
                  <th>Absent</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.days.map((day) =>
                  day.wards.map((ward) => {
                    const statuses = ward.roster.map((row) => row.status);
                    return (
                      <tr key={`${day.date}-${ward.wardId}`}>
                        <td>{formatDate(day.date)}</td>
                        <td>{ward.wardName}</td>
                        <td>{ward.activity}</td>
                        <td>{ward.location}</td>
                        <td>{statuses.filter((status) => status === "PRESENT").length}</td>
                        <td>{statuses.filter((status) => status === "LATE").length}</td>
                        <td>{statuses.filter((status) => status === "ABSENT").length}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          )}
          <h3>Approved work</h3>
          {snapshot.workLogs.length === 0 ? (
            <p className="empty">No approved work logs in this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ward</th>
                  <th>Activity</th>
                  <th>Location</th>
                  <th>Trips</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.workLogs.map((workLog) => (
                  <tr key={workLog.id}>
                    <td>{formatDate(workLog.date)}</td>
                    <td>{workLog.wardName}</td>
                    <td>{workLog.activity}</td>
                    <td>{workLog.location}</td>
                    <td>{workLog.numberOfTrips}</td>
                    <td>{workLog.photos.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Finalized reports</h2>
        {reports.length === 0 ? (
          <p className="empty">No finalized reports yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Period</th>
                <th>Kind</th>
                <th>Finalized</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.title}</td>
                  <td>
                    {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                  </td>
                  <td>{report.kind.toLowerCase()}</td>
                  <td>{report.finalizedAt ? formatDate(report.finalizedAt.slice(0, 10)) : "—"}</td>
                  <td>
                    <div className="doc-actions">
                      <button className="link-btn" onClick={() => void onOpen(report)}>
                        View
                      </button>
                      <button className="link-btn" onClick={() => void onCsv(report)}>
                        CSV
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function TotalsBar({ totals }: { totals: Record<string, number> }) {
  return (
    <div className="metrics">
      {Object.entries(totals).map(([status, count]) => (
        <div className="metric" key={status}>
          <span className="metric-value">{count}</span>
          <span className="metric-label">{status.replace(/_/g, " ").toLowerCase()}</span>
        </div>
      ))}
    </div>
  );
}