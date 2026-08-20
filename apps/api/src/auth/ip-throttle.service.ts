import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const MAX_ENTRIES = 5000;

interface ThrottleEntry {
  count: number;
  windowStart: number;
}

/**
 * Lightweight fixed-window per-key rate limiter used for public endpoints that
 * are not covered by login throttling (owner bootstrap, access requests). Like
 * the login throttle it is in-memory and therefore per-instance, which is
 * acceptable for a single-modular-monolith deployment.
 */
@Injectable()
export class IpThrottleService {
  private readonly buckets = new Map<string, ThrottleEntry>();

  /** Throws 429 once the caller exceeds `limit` requests within `windowMs`. */
  check(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const entry = this.buckets.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) {
      throw new HttpException(
        "Too many requests. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Keeps the in-memory map bounded by evicting the oldest entries. */
  private prune(): void {
    if (this.buckets.size <= MAX_ENTRIES) return;
    while (this.buckets.size > MAX_ENTRIES) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}