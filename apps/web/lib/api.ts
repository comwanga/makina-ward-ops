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