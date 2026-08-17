/**
 * Shared API contracts: standard error shape, pagination, and generic
 * envelope types. These are stable across the API and web client.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export interface HealthResponse {
  status: "ok";
}

export interface ReadyResponse {
  status: "ready";
  checks: {
    database: "up" | "down";
    storage: "up" | "down" | "not_configured";
  };
}

export interface CursorId {
  id: string;
}
