import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const MAX_ATTEMPTS = 15;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

interface ThrottleEntry {
  count: number;
  windowStart: number;
}

/** In-memory rate limiter matching the legacy 15 attempts / 10 min per (ip, token). */
@Injectable()
export class CheckInThrottleService {
  private readonly attempts = new Map<string, ThrottleEntry>();

  check(key: string): void {
    const entry = this.attempts.get(key);
    if (!entry) {
      return;
    }
    if (Date.now() - entry.windowStart > WINDOW_MS) {
      this.attempts.delete(key);
      return;
    }
    if (entry.count >= MAX_ATTEMPTS) {
      throw new HttpException(
        "Too many attempts. Ask your supervisor for assistance",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(key: string): void {
    this.prune();
    const now = Date.now();
    const entry = this.attempts.get(key) ?? { count: 0, windowStart: now };
    if (now - entry.windowStart > WINDOW_MS) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
    this.attempts.set(key, entry);
  }

  /** Keeps the in-memory map bounded by evicting expired entries first, then oldest entries. */
  private prune(): void {
    if (this.attempts.size <= MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (now - entry.windowStart > WINDOW_MS) {
        this.attempts.delete(key);
      }
    }
    while (this.attempts.size > MAX_ENTRIES) {
      const oldest = this.attempts.keys().next().value;
      if (oldest === undefined) break;
      this.attempts.delete(oldest);
    }
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  resetAll(): void {
    this.attempts.clear();
  }
}