"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import {
  ApiError,
  Employee,
  Ward,
  createStaff,
  fetchMe,
  listStaff,
  listWards,
  setStaffActive,
} from "@/lib/api";

export default function StaffPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    employeeNumber: "",
    fullName: "",
    phone: "",
    email: "",
    designation: "Green Army Staff",
    wardId: "",
  });

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
      const [staff, accessible] = await Promise.all([listStaff(), listWards()]);
      setEmployees(staff);
      setWards(accessible);
      if (!form.wardId && accessible.length > 0) {
        const preferred = accessible.find((w) => w.id === me.assignments[0]?.wardId);
        setForm((current) => ({ ...current, wardId: preferred?.id ?? accessible[0].id }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Unable to load staff");
      }
    }
  }, [router, form.wardId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await createStaff(form);
      setNotice(`Created ${form.fullName} (${form.employeeNumber}).`);
      setForm((current) => ({ ...current, employeeNumber: "", fullName: "", phone: "", email: "" }));
      setEmployees(await listStaff());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to create staff");
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggleActive(employee: Employee) {
    setError(null);
    setNotice(null);
    try {
      await setStaffActive(employee.id, !employee.active);
      setEmployees(await listStaff());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update staff");
    }
  }

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} />
        <div className="dash-title">
          <p className="eyebrow">MAKINA WARD · STAFF REGISTER</p>
          <h1>Staff</h1>
        </div>
        <nav className="dash-nav">
          <a href="/">Home</a>
          <a href="/staff" aria-current="page">Staff</a>
          <a href="/attendance">Attendance</a>
          <a href="/absences">Absences</a>
          <a href="/worklogs">Work logs</a>
        </nav>
      </header>

      <section className="panel">
        <h2>Add staff member</h2>
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-success">{notice}</p>}
        <form className="grid-form" onSubmit={onCreate}>
          <label>
            Employee number
            <input
              value={form.employeeNumber}
              onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
              placeholder="e.g. 20250100001"
              pattern="(19|20)\d{9}"
              required
            />
          </label>
          <label>
            Full name
            <input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </label>
          <label>
            Phone
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="0712 000 000"
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Designation
            <input
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
            />
          </label>
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
          <button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Add staff"}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Registered staff</h2>
        {employees.length === 0 ? (
          <p className="empty">No staff registered yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Ward</th>
                <th>Designation</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.employeeNumber}</td>
                  <td>{employee.fullName}</td>
                  <td>{employee.phone}</td>
                  <td>{employee.ward.code}</td>
                  <td>{employee.designation}</td>
                  <td>
                    <span className={`badge ${employee.active ? "ok" : "muted"}`}>
                      {employee.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="link-btn"
                      onClick={() => void onToggleActive(employee)}
                    >
                      {employee.active ? "Deactivate" : "Reactivate"}
                    </button>
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