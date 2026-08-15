import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

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