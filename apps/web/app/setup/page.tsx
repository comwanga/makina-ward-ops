"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { ApiError, bootstrapOwner } from "@/lib/api";

export default function SetupPage() {
  const [form, setForm] = useState({
    setupToken: "",
    email: "",
    password: "",
    displayName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await bootstrapOwner({
        setupToken: form.setupToken,
        email: form.email,
        password: form.password,
        displayName: form.displayName.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to complete setup");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="home">
      <section className="hero auth-hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>System owner setup</h1>
        <p className="subtitle">Create the first permanent owner account</p>

        {done ? (
          <div className="auth-form">
            <p className="form-success">
              System owner created. Sign in with the account you just created.
            </p>
            <p className="auth-links">
              <Link href="/login">Continue to sign in</Link>
            </p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            <label htmlFor="setupToken">Setup token</label>
            <input
              id="setupToken"
              type="password"
              autoComplete="off"
              value={form.setupToken}
              onChange={(event) => setForm({ ...form, setupToken: event.target.value })}
              required
            />
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              type="text"
              autoComplete="name"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
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
            {error && <p className="form-error">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create owner account"}
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
