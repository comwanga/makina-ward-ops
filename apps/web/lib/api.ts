export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (method !== "GET" && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return body as T;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  assignments: Array<{
    id: string;
    role: string;
    roleName: string;
    scopeType: string;
    countyId: string | null;
    subcountyId: string | null;
    wardId: string | null;
  }>;
}

export interface MeResponse {
  user: AuthUser & { capabilities: string[]; csrfToken: string } | null;
}

export interface LoginResponse {
  csrfToken: string;
  expiresAt: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const result = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function fetchMe(): Promise<MeResponse["user"]> {
  const result = await apiFetch<MeResponse>("/auth/me");
  if (result.user) {
    setCsrfToken(result.user.csrfToken);
  }
  return result.user;
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  setCsrfToken(null);
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export async function requestAccess(input: {
  displayName: string;
  email: string;
  password: string;
  reason: string;
}): Promise<void> {
  await apiFetch("/users/access-requests", {
    method: "POST",
    body: input,
  });
}

// -- Phase 3: staff -----------------------------------------------------------

export interface WardRef {
  id: string;
  code: string;
  name: string;
}

export interface Ward extends WardRef {
  subcountyId: string | null;
}

export async function listWards(): Promise<Ward[]> {
  const result = await apiFetch<{ wards: Ward[] }>("/organisations/wards");
  return result.wards;
}

export interface EmployeeProfile {
  residence: string | null;
  rosterStatus: string;
}

export interface Employee {
  id: string;
  employeeNumber: string;
  fullName: string;
  phone: string;
  email: string | null;
  designation: string;
  active: boolean;
  wardId: string;
  ward: WardRef;
  profile: EmployeeProfile;
  assignments: Array<{ id: string; wardId: string; designation: string }>;
}

export interface CreateEmployeeInput {
  employeeNumber: string;
  fullName: string;
  phone: string;
  email?: string;
  designation?: string;
  wardId: string;
}

export async function listStaff(): Promise<Employee[]> {
  return apiFetch<Employee[]>("/staff");
}

export async function createStaff(input: CreateEmployeeInput): Promise<Employee> {
  return apiFetch<Employee>("/staff", { method: "POST", body: input });
}

export async function setStaffActive(id: string, active: boolean): Promise<Employee> {
  return apiFetch<Employee>(`/staff/${id}/${active ? "reactivate" : "deactivate"}`, {
    method: "POST",
  });
}

// -- Phase 3: attendance ------------------------------------------------------

export interface AttendanceSession {
  id: string;
  token?: string;
  wardId: string;
  ward: WardRef;
  workDate: string;
  activity: string;
  location: string;
  opensAt: string;
  closesAt: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeNumber: string;
  fullName: string;
  wardId: string;
  sessionId: string;
  sessionActivity: string;
  workDate: string;
  checkedAt: string;
  status: string;
  verificationMethod: string;
}

export interface RosterRow {
  employee: { id: string; employeeNumber: string; fullName: string };
  status: string;
  detail: string;
  manualEditable: boolean;
}

export interface CreateSessionInput {
  wardId: string;
  activity: string;
  location: string;
  durationMinutes: number;
}

export async function listSessions(): Promise<AttendanceSession[]> {
  return apiFetch<AttendanceSession[]>("/attendance/sessions");
}

export async function createSession(input: CreateSessionInput): Promise<AttendanceSession> {
  return apiFetch<AttendanceSession>("/attendance/sessions", { method: "POST", body: input });
}

export async function listAttendance(): Promise<AttendanceRecord[]> {
  return apiFetch<AttendanceRecord[]>("/attendance");
}

export async function fetchRoster(wardId: string): Promise<RosterRow[]> {
  return apiFetch<RosterRow[]>(`/attendance/roster?wardId=${encodeURIComponent(wardId)}`);
}

export interface ManualAttendanceInput {
  employeeId: string;
  workDate: string;
  status: string;
  reason: string;
}

export async function manualAttendance(input: ManualAttendanceInput): Promise<unknown> {
  return apiFetch("/attendance/manual", { method: "POST", body: input });
}

export interface CheckInResponse {
  ok: boolean;
  message: string;
  status: string;
  employee: { id: string; fullName: string };
  checkedAt: string;
}

export async function checkInPublic(
  sessionToken: string,
  employeeNumber: string,
  latitude?: number | null,
  longitude?: number | null,
): Promise<CheckInResponse> {
  return apiFetch<CheckInResponse>(`/attendance/sessions/${encodeURIComponent(sessionToken)}/check-in`, {
    method: "POST",
    body: { employeeNumber, latitude, longitude },
  });
}

// -- Phase 4: absence management ---------------------------------------------

export type AbsenceKind =
  | "ANNUAL_LEAVE"
  | "MATERNITY_LEAVE"
  | "PATERNITY_LEAVE"
  | "COMPASSIONATE_LEAVE"
  | "SICK_OFF"
  | "OFFICIAL_DUTY"
  | "UNPAID_LEAVE";

export type AbsenceStatus =
  | "PLANNED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export type AbsenceAction = "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL";

export interface AbsenceDocument {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  sensitivity: string;
  category: string;
}

export interface Absence {
  id: string;
  employee: { id: string; employeeNumber: string; fullName: string };
  wardId: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  returnDate: string;
  reason: string;
  status: AbsenceStatus;
  version: number;
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  documents: AbsenceDocument[];
}

export interface CreateAbsenceInput {
  employeeId: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  returnDate: string;
  reason: string;
  planned?: boolean;
}

export async function listAbsences(query?: {
  wardId?: string;
  status?: AbsenceStatus;
  employeeId?: string;
}): Promise<Absence[]> {
  const params = new URLSearchParams();
  if (query?.wardId) params.set("wardId", query.wardId);
  if (query?.status) params.set("status", query.status);
  if (query?.employeeId) params.set("employeeId", query.employeeId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<Absence[]>(`/absence-requests${suffix}`);
}

export async function createAbsence(input: CreateAbsenceInput): Promise<Absence> {
  return apiFetch<Absence>("/absence-requests", { method: "POST", body: input });
}

export async function absenceAction(
  id: string,
  input: { action: AbsenceAction; reviewNote?: string },
): Promise<Absence> {
  return apiFetch<Absence>(`/absence-requests/${id}/actions`, {
    method: "POST",
    body: input,
  });
}

export async function uploadAbsenceDocument(
  id: string,
  file: File,
  category: string,
): Promise<AbsenceDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("documentCategory", category);
  const headers: Record<string, string> = {};
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  const response = await fetch(`${API_URL}/absence-requests/${id}/documents`, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return body as AbsenceDocument;
}

export async function downloadAbsenceDocument(documentId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/absence-requests/documents/${documentId}/download`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}

export type WorkLogStatus = "SUBMITTED" | "APPROVED" | "REJECTED";
export type WorkLogAction = "APPROVE" | "REJECT";
export type CompletionStatus = "COMPLETE" | "INCOMPLETE";

export interface WorkLogOperations {
  areasRoads: string;
  numberOfTrips: number;
  wasteTransferInvolved: boolean;
  truckId: string | null;
  backhoeId: string | null;
  cleanupDone: boolean;
  cleanupStakeholders: string | null;
  climateTeamCount: number;
}

export interface WorkLogDetail {
  completionStatus: CompletionStatus;
  outstandingWork: string | null;
}

export interface WorkLog {
  id: string;
  wardId: string;
  workDate: string;
  activity: string;
  location: string;
  description: string;
  staffCount: number;
  challenges: string | null;
  status: WorkLogStatus;
  version: number;
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  detail: WorkLogDetail;
  operations: WorkLogOperations;
}

export interface CreateWorkLogInput {
  wardId: string;
  workDate: string;
  activity: string;
  location: string;
  areasRoads: string;
  description: string;
  numberOfTrips?: number;
  wasteTransferInvolved?: boolean;
  truckId?: string;
  backhoeId?: string;
  staffCount?: number;
  challenges?: string | null;
  cleanupDone?: boolean;
  cleanupStakeholders?: string;
  climateTeamCount?: number;
  completionStatus?: CompletionStatus;
  outstandingWork?: string;
}

export async function listWorkLogs(query?: {
  wardId?: string;
  workDate?: string;
  status?: WorkLogStatus;
}): Promise<WorkLog[]> {
  const params = new URLSearchParams();
  if (query?.wardId) params.set("wardId", query.wardId);
  if (query?.workDate) params.set("workDate", query.workDate);
  if (query?.status) params.set("status", query.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<WorkLog[]>(`/work-logs${suffix}`);
}

export async function createWorkLog(input: CreateWorkLogInput): Promise<WorkLog> {
  return apiFetch<WorkLog>("/work-logs", { method: "POST", body: input });
}

export async function workLogAction(
  id: string,
  input: { action: WorkLogAction; reviewNote?: string },
): Promise<WorkLog> {
  return apiFetch<WorkLog>(`/work-logs/${id}/actions`, {
    method: "POST",
    body: input,
  });
}

export type EvidenceStage = "BEFORE" | "DURING" | "AFTER";

export interface Evidence {
  id: string;
  workLogId: string;
  stage: EvidenceStage;
  caption: string | null;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy: string;
  createdAt: string;
}

export async function listEvidence(workLogId: string): Promise<Evidence[]> {
  return apiFetch<Evidence[]>(`/evidence?workLogId=${encodeURIComponent(workLogId)}`);
}

export async function uploadEvidence(
  workLogId: string,
  file: File,
  stage: EvidenceStage,
  caption: string,
): Promise<Evidence> {
  const form = new FormData();
  form.append("file", file);
  form.append("workLogId", workLogId);
  form.append("stage", stage);
  form.append("caption", caption);
  const headers: Record<string, string> = {};
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  const response = await fetch(`${API_URL}/evidence`, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return body as Evidence;
}

export async function downloadEvidence(evidenceId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/evidence/${evidenceId}/download`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}

// -- Phase 7: reports ---------------------------------------------------------

export type ReportKind = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
export type ReportStatus = "DRAFT" | "FINALIZED";
export type ReportScopeType = "COUNTY" | "SUBCOUNTY" | "WARD";

export interface OrganisationWard {
  id: string;
  code: string;
  name: string;
  subcountyId: string;
}

export interface OrganisationSubcounty {
  id: string;
  code: string;
  name: string;
  wards: OrganisationWard[];
}

export interface OrganisationCounty {
  id: string;
  code: string;
  name: string;
  subcounties: OrganisationSubcounty[];
}

export interface ReportPhotoRef {
  evidenceId: string;
  objectKey: string;
  sha256: string;
  caption: string | null;
  stage: string;
}

export interface ReportRosterRow {
  employeeNumber: string;
  fullName: string;
  role: string | null;
  status: string;
  detail: string;
}

export interface ReportDayWard {
  wardId: string;
  wardName: string;
  activity: string;
  location: string;
  roster: ReportRosterRow[];
}

export interface ReportDay {
  date: string;
  wards: ReportDayWard[];
}

export interface ReportWorkLog {
  id: string;
  wardId: string;
  wardName: string;
  date: string;
  activity: string;
  location: string;
  areasRoads: string;
  description: string;
  numberOfTrips: number;
  wasteTransferInvolved: boolean;
  truckId: string | null;
  backhoeId: string | null;
  cleanupDone: boolean;
  cleanupStakeholders: string | null;
  climateTeamCount: number;
  staffCount: number;
  challenges: string | null;
  completionStatus: string;
  outstandingWork: string | null;
  photos: ReportPhotoRef[];
}

export interface ReportSnapshot {
  scopeType: ReportScopeType;
  scopeId: string;
  scopeName: string;
  startDate: string;
  endDate: string;
  kind: ReportKind;
  generatedAt: string;
  signedBy: string | null;
  signedTitle: string | null;
  totals: Record<string, number>;
  days: ReportDay[];
  workLogs: ReportWorkLog[];
}

export interface ReportEvidenceRef {
  id: string;
  evidenceId: string | null;
  objectKey: string;
  sha256: string;
  caption: string | null;
  stage: string;
}

export interface Report {
  id: string;
  kind: ReportKind;
  scopeType: ReportScopeType;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  title: string;
  narrative: string;
  recommendations: string;
  snapshot: ReportSnapshot;
  version: number;
  finalizedBy: string | null;
  finalizedAt: string | null;
  createdBy: string;
  createdAt: string;
  evidence: ReportEvidenceRef[];
}

export interface ReportSummary {
  id: string;
  kind: ReportKind;
  scopeType: ReportScopeType;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  title: string;
  version: number;
  finalizedBy: string | null;
  finalizedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ReportPreview {
  snapshot: ReportSnapshot;
  narrative: string;
  recommendations: string;
  title: string;
}

export interface ReportAiDraft extends ReportPreview {
  narrativeSource: "ai" | "deterministic";
}

export interface ReportPeriodInput {
  scopeType: ReportScopeType;
  scopeId: string;
  startDate: string;
  endDate: string;
  kind: ReportKind;
}

export async function fetchOrganisationTree(): Promise<OrganisationCounty[]> {
  const result = await apiFetch<{ counties: OrganisationCounty[] }>("/organisations");
  return result.counties;
}

export async function previewReport(input: ReportPeriodInput): Promise<ReportPreview> {
  const params = new URLSearchParams();
  params.set("scopeType", input.scopeType);
  params.set("scopeId", input.scopeId);
  params.set("startDate", input.startDate);
  params.set("endDate", input.endDate);
  params.set("kind", input.kind);
  return apiFetch<ReportPreview>(`/reports/preview?${params.toString()}`);
}

export async function draftReportNarrative(input: ReportPeriodInput): Promise<ReportAiDraft> {
  return apiFetch<ReportAiDraft>("/reports/ai-draft", { method: "POST", body: input });
}

export async function finalizeReport(
  input: ReportPeriodInput & { narrative?: string; recommendations?: string },
): Promise<Report> {
  return apiFetch<Report>("/reports", { method: "POST", body: input });
}

export async function listReports(query?: {
  scopeType?: ReportScopeType;
  scopeId?: string;
  kind?: ReportKind;
}): Promise<ReportSummary[]> {
  const params = new URLSearchParams();
  if (query?.scopeType) params.set("scopeType", query.scopeType);
  if (query?.scopeId) params.set("scopeId", query.scopeId);
  if (query?.kind) params.set("kind", query.kind);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<ReportSummary[]>(`/reports${suffix}`);
}

export async function fetchReport(id: string): Promise<Report> {
  return apiFetch<Report>(`/reports/${encodeURIComponent(id)}`);
}

export async function downloadReportCsv(id: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/reports/${encodeURIComponent(id)}/csv`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}