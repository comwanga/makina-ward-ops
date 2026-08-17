import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 5000;

interface ThrottleEntry {
  count: number;
  lockedUntil: number;
  firstAttemptAt: number;
}

@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, ThrottleEntry>();

  check(key: string): void {
    const entry = this.attempts.get(key);
    if (!entry) {
      return;
    }
    if (entry.lockedUntil > Date.now()) {
      throw new HttpException(
        "Too many failed attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (Date.now() - entry.firstAttemptAt > WINDOW_MS) {
      this.attempts.delete(key);
    }
  }

  recordFailure(key: string): void {
    this.prune();
    const now = Date.now();
    const entry = this.attempts.get(key) ?? { count: 0, lockedUntil: 0, firstAttemptAt: now };
    if (entry.lockedUntil > now) {
      return;
    }
    if (now - entry.firstAttemptAt > WINDOW_MS) {
      this.attempts.set(key, { count: 1, lockedUntil: 0, firstAttemptAt: now });
      return;
    }
    entry.count += 1;
    if (entry.count >= MAX_ATTEMPTS) {
      entry.lockedUntil = now + WINDOW_MS;
    }
    this.attempts.set(key, entry);
  }

  /** Keeps the in-memory map bounded by evicting expired entries first, then oldest entries. */
  private prune(): void {
    if (this.attempts.size <= MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (now - entry.firstAttemptAt > WINDOW_MS) {
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

  reset(key: string): void {
    this.attempts.delete(key);
  }

  resetAll(): void {
    this.attempts.clear();
  }
}