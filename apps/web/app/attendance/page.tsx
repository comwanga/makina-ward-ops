"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import {
  ApiError,
  AttendanceRecord,
  AttendanceSession,
  RosterRow,
  Ward,
  createSession,
  fetchMe,
  fetchRoster,
  listAttendance,
  listSessions,
  listWards,
} from "@/lib/api";

const DURATIONS = [30, 60, 120, 240, 480];

export default function AttendancePage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [wards, setWards] = useState<Ward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    wardId: "",
    activity: "Cleaning",
    location: "",
    durationMinutes: 120,
  });

  const load = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (!me) {
        router.push("/login");
        return;
      }
      const [sessionList, recordList, accessible] = await Promise.all([
        listSessions(),
        listAttendance(),
        listWards(),
      ]);
      setSessions(sessionList);
      setRecords(recordList);
      setWards(accessible);
      if (form.wardId) {
        setRoster(await fetchRoster(form.wardId));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Unable to load attendance");
      }
    }
  }, [router, form.wardId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const session = await createSession(form);
      setNotice(`Session opened — token ${session.token.slice(0, 12)}…`);
      setForm((current) => ({ ...current, location: "" }));
      setSessions(await listSessions());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to open session");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSelectWard(wardId: string) {
    setForm((current) => ({ ...current, wardId }));
    setError(null);
    try {
      setRoster(await fetchRoster(wardId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load roster");
    }
  }

  const checkInUrl = (session: AttendanceSession) =>
    `${window.location.origin}/check-in/${session.token}`;

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} />
        <div className="dash-title">
          <p className="eyebrow">MAKINA WARD · ATTENDANCE</p>
          <h1>Attendance</h1>
        </div>
        <nav className="dash-nav">
          <a href="/">Home</a>
          <a href="/staff">Staff</a>
          <a href="/attendance" aria-current="page">Attendance</a>
        </nav>
      </header>

      <section className="panel">
        <h2>Open an attendance session</h2>
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-success">{notice}</p>}
        <form className="grid-form" onSubmit={onCreateSession}>
          <label>
            Ward
            <select
              value={form.wardId}
              onChange={(e) => setForm({ ...form, wardId: e.target.value })}
              required
            >
              <option value="">Select ward…</option>
              {wards.map((ward) => (
                <option key={ward.id} value={ward.id}>
                  {ward.name} ({ward.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Activity
            <select
              value={form.activity}
              onChange={(e) => setForm({ ...form, activity: e.target.value })}
            >
              <option>Cleaning</option>
              <option>Sweeping</option>
              <option>Drainage</option>
              <option>Garbage collection</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            Location
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Makina Ward Office"
              required
            />
          </label>
          <label>
            Duration (minutes)
            <select
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
            >
              {DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Opening…" : "Open session"}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Active sessions</h2>
        {sessions.length === 0 ? (
          <p className="empty">No sessions have been opened.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>Activity</th>
                <th>Location</th>
                <th>Opens</th>
                <th>Closes</th>
                <th>Check-in link</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>{session.ward.code}</td>
                  <td>{session.activity}</td>
                  <td>{session.location}</td>
                  <td>{new Date(session.opensAt).toLocaleTimeString()}</td>
                  <td>{new Date(session.closesAt).toLocaleTimeString()}</td>
                  <td>
                    <a className="checkin-link" href={checkInUrl(session)}>
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Roster</h2>
        <label className="inline-label">
          Ward
          <select
            value={form.wardId}
            onChange={(e) => void onSelectWard(e.target.value)}
          >
            <option value="">Select ward…</option>
            {wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {ward.name} ({ward.code})
              </option>
            ))}
          </select>
        </label>
        {roster && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => (
                <tr key={row.employee.id}>
                  <td>{row.employee.employeeNumber}</td>
                  <td>{row.employee.fullName}</td>
                  <td>
                    <span className={`badge ${row.status.toLowerCase()}`}>{row.status}</span>
                  </td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Attendance records</h2>
        {records.length === 0 ? (
          <p className="empty">No check-ins recorded.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Ward</th>
                <th>Status</th>
                <th>Checked at</th>
                <th>Via</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.workDate}</td>
                  <td>
                    {record.fullName} <span className="muted-text">({record.employeeNumber})</span>
                  </td>
                  <td>{record.wardId.slice(0, 8)}</td>
                  <td>
                    <span className={`badge ${record.status.toLowerCase()}`}>{record.status}</span>
                  </td>
                  <td>{new Date(record.checkedAt).toLocaleTimeString()}</td>
                  <td>{record.verificationMethod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}