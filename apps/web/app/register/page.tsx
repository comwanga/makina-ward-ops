"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { ApiError, requestAccess } from "@/lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    password: "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestAccess(form);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="home">
      <section className="hero auth-hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>Request access</h1>
        <p className="subtitle">Benchmark visitors can request read-only access</p>

        {done ? (
          <div className="auth-form">
            <p className="form-success">
              Request received. The owner will review it under User access.
            </p>
            <p className="auth-links">
              <Link href="/login">Back to sign in</Link>
            </p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            <label htmlFor="displayName">Full name</label>
            <input
              id="displayName"
              type="text"
              autoComplete="name"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              minLength={2}
              required
            />
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              minLength={12}
              required
            />
            <label htmlFor="reason">Reason for access</label>
            <textarea
              id="reason"
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              minLength={5}
              required
            />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </form>
        )}

        <p className="auth-links">
          <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
