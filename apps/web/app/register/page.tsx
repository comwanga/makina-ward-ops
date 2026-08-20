"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { StatusMessages } from "@/components/StatusMessages";
import {
  apiErrorMessage,
  listPublicOrganisations,
  PublicOrganisationTree,
  requestAccess,
} from "@/lib/api";

type ScopeOption = { type: "COUNTY" | "SUBCOUNTY" | "WARD"; id: string; label: string };

function scopeOptions(tree: PublicOrganisationTree): ScopeOption[] {
  return tree.counties.flatMap((county) => [
    { type: "COUNTY" as const, id: county.id, label: county.name },
    ...county.subcounties.flatMap((subcounty) => [
      {
        type: "SUBCOUNTY" as const,
        id: subcounty.id,
        label: `${subcounty.name} Sub-County`,
      },
      ...subcounty.wards.map((ward) => ({
        type: "WARD" as const,
        id: ward.id,
        label: `${ward.name} Ward`,
      })),
    ]),
  ]);
}

export default function RegisterPage() {
  const [options, setOptions] = useState<ScopeOption[]>([]);
  const [scopeKey, setScopeKey] = useState("");
  const [form, setForm] = useState({ displayName: "", email: "", password: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void listPublicOrganisations()
      .then((tree) => {
        const next = scopeOptions(tree);
        setOptions(next);
        setScopeKey(next[0] ? `${next[0].type}:${next[0].id}` : "");
      })
      .catch((cause) => setError(apiErrorMessage(cause, "Unable to load organisation scopes")));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = options.find((option) => `${option.type}:${option.id}` === scopeKey);
    if (!selected) {
      setError("Select the organisation scope where you will work.");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await requestAccess({
        ...form,
        requestedScope: selected.type,
        requestedScopeId: selected.id,
      });
      setNotice("Your access request was submitted for administrator review.");
      setForm({ displayName: "", email: "", password: "", reason: "" });
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to submit the access request"));
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
        <p className="subtitle">Access is issued for a specific county, subcounty, or ward.</p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="display-name">Full name</label>
          <input
            id="display-name"
            value={form.displayName}
            onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
            required
          />
          <label htmlFor="email">Official email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            required
          />
          <label htmlFor="password">Temporary password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            required
          />
          <label htmlFor="scope">Requested organisation scope</label>
          <select
            id="scope"
            value={scopeKey}
            onChange={(event) => setScopeKey(event.target.value)}
            disabled={!options.length}
            required
          >
            {!options.length && <option value="">Loading scopes...</option>}
            {options.map((option) => (
              <option key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}>
                {option.label}
              </option>
            ))}
          </select>
          <label htmlFor="reason">Reason for access</label>
          <textarea
            id="reason"
            value={form.reason}
            onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            required
          />
          <StatusMessages error={error} notice={notice} />
          <button type="submit" disabled={submitting || !options.length}>
            {submitting ? "Submitting..." : "Submit request"}
          </button>
        </form>

        <p className="auth-links">
          <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
