"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { DashNav } from "@/components/DashNav";
import { ApiError, CompletionStatus, Evidence, EvidenceStage, Ward, WorkLog, WorkLogAction, createWorkLog, downloadEvidence, fetchMe, listEvidence, listWards, listWorkLogs, uploadEvidence, workLogAction } from "@/lib/api";
import { compressImage } from "@/lib/image";

const STAGES: EvidenceStage[] = ["BEFORE", "DURING", "AFTER"];

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

export default function WorkLogsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ capabilities: string[] } | null>(null);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [evidenceByWorkLog, setEvidenceByWorkLog] = useState<Record<string, Evidence[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [form, setForm] = useState({
    wardId: "",
    workDate: nairobiToday(),
    activity: "",
    location: "",
    areasRoads: "",
    description: "",
    staffCount: 0,
    challenges: "",
    numberOfTrips: 0,
    wasteTransferInvolved: false,
    truckId: "",
    backhoeId: "",
    cleanupDone: false,
    cleanupStakeholders: "",
    climateTeamCount: 0,
    completionStatus: "COMPLETE" as CompletionStatus,
    outstandingWork: "",
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
      const accessible = await listWards();
      setWards(accessible);
      setForm((currentForm) => ({
        ...currentForm,
        wardId: currentForm.wardId || accessible[0]?.id || "",
      }));
      setWorkLogs(await listWorkLogs());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Unable to load work logs");
      }
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadEvidenceFor(workLogId: string) {
    try {
      const items = await listEvidence(workLogId);
      setEvidenceByWorkLog((current) => ({ ...current, [workLogId]: items }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load evidence");
    }
  }

  async function onUploadEvidence(workLog: WorkLog, file: File | null, stage: EvidenceStage) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setUploading(stage);
    setUploadProgress(0);
    try {
      const prepared = await compressImage(file);
      await uploadEvidence(
        workLog.id,
        prepared,
        stage,
        "",
        setUploadProgress,
      );
      setUploading(null);
      setUploadProgress(null);
      setNotice(`${stage.toLowerCase()} photo uploaded.`);
      await loadEvidenceFor(workLog.id);
    } catch (err) {
      setUploading(null);
      setUploadProgress(null);
      setError(err instanceof ApiError ? err.message : "Unable to upload photo");
    }
  }

  async function onOpenEvidence(evidence: Evidence) {
    setError(null);
    try {
      const blob = await downloadEvidence(evidence.id);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to open photo");
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await createWorkLog(form);
      setNotice(`Logged ${created.activity} for ${formatDate(created.workDate)}.`);
      setForm((current) => ({
        ...current,
        activity: "",
        location: "",
        areasRoads: "",
        description: "",
        challenges: "",
        cleanupStakeholders: "",
        outstandingWork: "",
      }));
      setWorkLogs(await listWorkLogs());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to create work log");
    } finally {
      setSubmitting(false);
    }
  }

  async function onAction(workLog: WorkLog, action: WorkLogAction) {
    setError(null);
    setNotice(null);
    try {
      let reviewNote: string | undefined;
      if (action === "REJECT") {
        reviewNote = window.prompt("Rejection note (at least 3 characters)") ?? "";
        if (!reviewNote.trim()) {
          setError("A rejection note is required.");
          return;
        }
      }
      await workLogAction(workLog.id, { action, reviewNote });
      setWorkLogs(await listWorkLogs());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to update work log");
    }
  }

  const actionsFor = (workLog: WorkLog) => {
    const actions: Array<{ action: WorkLogAction; label: string; capability: string }> = [];
    if (workLog.status === "SUBMITTED") {
      actions.push({ action: "APPROVE", label: "Approve", capability: "WORK_REVIEW" });
      actions.push({ action: "REJECT", label: "Reject", capability: "WORK_REVIEW" });
    }
    return actions.filter((item) => can(item.capability));
  };

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · WORK OPERATIONS</p>
          <h1>Work logs</h1>
        </div>
        <DashNav />
      </header>

      {can("WORK_CREATE") && (
        <section className="panel">
          <h2>New work log</h2>
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-success">{notice}</p>}
          <form className="grid-form" onSubmit={onCreate}>
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
              Work date
              <input
                type="date"
                value={form.workDate}
                onChange={(e) => setForm({ ...form, workDate: e.target.value })}
                required
              />
            </label>
            <label>
              Activity
              <input
                value={form.activity}
                onChange={(e) => setForm({ ...form, activity: e.target.value })}
                placeholder="e.g. desilting drainage"
                required
              />
            </label>
            <label>
              Location
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Makina Market area"
                required
              />
            </label>
            <label>
              Areas / roads covered
              <input
                value={form.areasRoads}
                onChange={(e) => setForm({ ...form, areasRoads: e.target.value })}
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                required
              />
            </label>
            <label>
              Staff count
              <input
                type="number"
                min={0}
                value={form.staffCount}
                onChange={(e) =>
                  setForm({ ...form, staffCount: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Challenges
              <input
                value={form.challenges}
                onChange={(e) => setForm({ ...form, challenges: e.target.value })}
              />
            </label>
            <label>
              Number of trips
              <input
                type="number"
                min={0}
                value={form.numberOfTrips}
                onChange={(e) =>
                  setForm({ ...form, numberOfTrips: Number(e.target.value) })
                }
              />
            </label>
            <label className="inline-label">
              <input
                type="checkbox"
                checked={form.wasteTransferInvolved}
                onChange={(e) =>
                  setForm({ ...form, wasteTransferInvolved: e.target.checked })
                }
              />
              Waste transfer involved
            </label>
            <label>
              Truck ID
              <input
                value={form.truckId}
                onChange={(e) => setForm({ ...form, truckId: e.target.value })}
                placeholder="T-161"
              />
            </label>
            <label>
              Backhoe ID
              <input
                value={form.backhoeId}
                onChange={(e) => setForm({ ...form, backhoeId: e.target.value })}
                placeholder="BH13"
              />
            </label>
            <label className="inline-label">
              <input
                type="checkbox"
                checked={form.cleanupDone}
                onChange={(e) => setForm({ ...form, cleanupDone: e.target.checked })}
              />
              Cleanup done
            </label>
            <label>
              Cleanup stakeholders
              <input
                value={form.cleanupStakeholders}
                onChange={(e) =>
                  setForm({ ...form, cleanupStakeholders: e.target.value })
                }
              />
            </label>
            <label>
              Climate works team count
              <input
                type="number"
                min={0}
                value={form.climateTeamCount}
                onChange={(e) =>
                  setForm({ ...form, climateTeamCount: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Completion
              <select
                value={form.completionStatus}
                onChange={(e) =>
                  setForm({
                    ...form,
                    completionStatus: e.target.value as CompletionStatus,
                  })
                }
              >
                <option value="COMPLETE">Complete</option>
                <option value="INCOMPLETE">Incomplete</option>
              </select>
            </label>
            <label>
              Outstanding work
              <textarea
                value={form.outstandingWork}
                onChange={(e) => setForm({ ...form, outstandingWork: e.target.value })}
                rows={2}
                placeholder="Describe outstanding work if incomplete"
              />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Submit work log"}
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Work logs</h2>
        {workLogs.length === 0 ? (
          <p className="empty">No work logs recorded.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Activity</th>
                <th>Location</th>
                <th>Status</th>
                <th>Completion</th>
                <th>Evidence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {workLogs.map((workLog) => (
                <tr key={workLog.id}>
                  <td>{formatDate(workLog.workDate)}</td>
                  <td>
                    {workLog.activity}
                    <span className="muted-text"> — {workLog.description}</span>
                  </td>
                  <td>{workLog.location}</td>
                  <td>
                    <span className={`badge ${workLog.status.toLowerCase()}`}>
                      {workLog.status}
                    </span>
                    {workLog.reviewNote && (
                      <span className="muted-text"> — {workLog.reviewNote}</span>
                    )}
                  </td>
                  <td>
                    {workLog.detail.completionStatus === "INCOMPLETE"
                      ? `Incomplete — ${workLog.detail.outstandingWork}`
                      : "Complete"}
                  </td>
                  <td>
                    {can("WORK_READ") && (
                      <EvidenceCell
                        evidence={evidenceByWorkLog[workLog.id] ?? []}
                        canUpload={can("WORK_CREATE")}
                        onOpen={onOpenEvidence}
                        onUploaded={(file, stage) => void onUploadEvidence(workLog, file, stage)}
                        uploadingStage={uploading}
                        uploadProgress={uploadProgress}
                      />
                    )}
                  </td>
                  <td>
                    <div className="doc-actions">
                      {actionsFor(workLog).map((item) => (
                        <button
                          key={item.action}
                          className="link-btn"
                          onClick={() => void onAction(workLog, item.action)}
                        >
                          {item.label}
                        </button>
                      ))}
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

function EvidenceCell({
  evidence,
  canUpload,
  onOpen,
  onUploaded,
  uploadingStage,
  uploadProgress,
}: {
  evidence: Evidence[];
  canUpload: boolean;
  onOpen: (evidence: Evidence) => void;
  onUploaded: (file: File | null, stage: EvidenceStage) => void;
  uploadingStage: string | null;
  uploadProgress: number | null;
}) {
  return (
    <div className="doc-list">
      {STAGES.map((stage) => {
        const items = evidence.filter((item) => item.stage === stage);
        return (
          <span key={stage} className="doc-stage">
            <strong>{stage.toLowerCase()}</strong> ({items.length})
            {items.map((item) => (
              <a
                key={item.id}
                className="link-btn"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(item);
                }}
              >
                view
              </a>
            ))}
            {canUpload && (
              <label className="link-btn">
                {uploadingStage === stage
                  ? uploadProgress !== null
                    ? `uploading ${uploadProgress}%`
                    : "preparing…"
                  : "+ upload"}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  className="visually-hidden"
                  disabled={uploadingStage !== null}
                  onChange={(e) => onUploaded(e.target.files?.[0] ?? null, stage)}
                />
              </label>
            )}
          </span>
        );
      })}
    </div>
  );
}