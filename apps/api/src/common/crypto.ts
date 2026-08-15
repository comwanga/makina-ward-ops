import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";

export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 24;
export const PASSWORD_SALT_BYTES = 16;

/**
 * scrypt password hash in the format `scrypt$<saltHex>$<derivedHex>`.
 * The format matches the legacy Makina app so existing hashes remain
 * verifiable during migration.
 */
export function hashPassword(password: string, salt?: Buffer): string {
  const saltBytes = salt ?? randomBytes(PASSWORD_SALT_BYTES);
  const derived = scryptSync(password, saltBytes, 64, { N: 2 ** 14, r: 8, p: 1 });
  return `scrypt$${saltBytes.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** SHA-256 hex digest used to store opaque session tokens at rest. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function randomCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
}

export { randomUUID };

export function tokensEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}