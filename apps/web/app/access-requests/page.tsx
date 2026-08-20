"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { DashNav } from "@/components/DashNav";
import {
  AccessRequest,
  AccessRequestDecision,
  ApiError,
  OrganisationCounty,
  ReportScopeType,
  RoleCode,
  fetchMe,
  fetchOrganisationTree,
  listAccessRequests,
  reviewAccessRequest,
} from "@/lib/api";

const ROLE_OPTIONS: Array<{ code: RoleCode; label: string }> = [
  { code: "WARD_OFFICER", label: "Ward officer" },
  { code: "SUBCOUNTY_REVIEWER", label: "Subcounty reviewer" },
  { code: "HR_VIEWER", label: "HR viewer" },
  { code: "READ_ONLY", label: "Read-only" },
];

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

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
}

interface ReviewDraft {
  roleCode: RoleCode;
  scopeType: ReportScopeType | "";
  scopeId: string;
  note: string;
}

function defaultDraft(request: AccessRequest): ReviewDraft {
  return {
    roleCode: "READ_ONLY",
    scopeType: (request.requestedScope ?? "") as ReviewDraft["scopeType"],
    scopeId: request.requestedScopeId ?? "",
    note: "",
  };
}

export default function AccessRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      if (!me.capabilities.includes("USERS_MANAGE")) {
        router.push("/");
        return;
      }
      const counties = await fetchOrganisationTree();
      setScopes(flattenScopes(counties));
      const items = await listAccessRequests();
      setRequests(items);
      setReviews(
        Object.fromEntries(items.map((item) => [item.id, defaultDraft(item)])),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Unable to load access requests");
      }
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateReview(id: string, patch: Partial<ReviewDraft>) {
    setReviews((current) => ({
      ...current,
      [id]: { ...(current[id] ?? defaultDraft({ id, requestedScope: "", requestedScopeId: null } as AccessRequest)), ...patch },
    }));
  }

  async function decide(id: string, action: "approve" | "reject") {
    const draft = reviews[id];
    setError(null);
    setNotice(null);
    setBusy(id);
    try {
      const decision: AccessRequestDecision = { action, note: draft?.note || undefined };
      if (action === "approve") {
        decision.roleCode = draft?.roleCode ?? "READ_ONLY";
        if (draft?.scopeType && draft.scopeId) {
          decision.scopeType = draft.scopeType;
          decision.scopeId = draft.scopeId;
        }
      }
      await reviewAccessRequest(id, decision);
      setNotice(
        action === "approve"
          ? `Approved ${requests.find((request) => request.id === id)?.email ?? "the request"}.`
          : "Request rejected.",
      );
      const items = await listAccessRequests();
      setRequests(items);
      setReviews((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to review request");
    } finally {
      setBusy(null);
    }
  }

  const pending = requests.filter((request) => request.status === "PENDING");

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · USER ACCESS</p>
          <h1>Access requests</h1>
        </div>
        <DashNav />
      </header>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-success">{notice}</p>}

      {pending.length === 0 ? (
        <section className="panel">
          <h2>Pending requests</h2>
          <p className="empty">No access requests waiting for review.</p>
        </section>
      ) : (
        pending.map((request) => {
          const draft = reviews[request.id];
          return (
            <section className="panel" key={request.id}>
              <h2>{request.displayName}</h2>
              <p className="muted-text">
                {request.email} · requested {formatWhen(request.createdAt)}
              </p>
              {request.reason && <p className="muted-text">“{request.reason}”</p>}
              {request.requestedScope && (
                <p className="muted-text">
                  Requested scope: {request.requestedScope}
                  {request.requestedScopeId ? ` · ${request.requestedScopeId}` : ""}
                </p>
              )}
              <form
                className="grid-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void decide(request.id, "approve");
                }}
              >
                <label>
                  Role
                  <select
                    value={draft?.roleCode ?? "READ_ONLY"}
                    onChange={(event) =>
                      updateReview(request.id, { roleCode: event.target.value as RoleCode })
                    }
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Scope
                  <select
                    value={draft?.scopeId ?? ""}
                    onChange={(event) => {
                      const scope = scopes.find((option) => option.scopeId === event.target.value);
                      updateReview(request.id, {
                        scopeId: event.target.value,
                        scopeType: scope?.scopeType ?? "",
                      });
                    }}
                    required={!request.requestedScopeId}
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
                  Review note
                  <input
                    type="text"
                    value={draft?.note ?? ""}
                    maxLength={500}
                    placeholder="Optional note to the requester"
                    onChange={(event) => updateReview(request.id, { note: event.target.value })}
                  />
                </label>
                <div className="review-actions">
                  <button type="submit" disabled={busy === request.id}>
                    {busy === request.id ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void decide(request.id, "reject")}
                    disabled={busy === request.id}
                  >
                    Reject
                  </button>
                </div>
              </form>
            </section>
          );
        })
      )}

      {requests.some((request) => request.status !== "PENDING") && (
        <section className="panel">
          <h2>Reviewed</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Scope</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {requests
                .filter((request) => request.status !== "PENDING")
                .map((request) => (
                  <tr key={request.id}>
                    <td>{request.displayName}</td>
                    <td>{request.email}</td>
                    <td>
                      <span className={`badge ${request.status === "APPROVED" ? "approved" : "rejected"}`}>
                        {request.status}
                      </span>
                    </td>
                    <td>
                      {request.requestedScope ? `${request.requestedScope} · ${request.requestedScopeId ?? ""}` : "—"}
                    </td>
                    <td>{request.reason}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}