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