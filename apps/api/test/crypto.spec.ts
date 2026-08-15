import { describe, expect, it } from "vitest";
import {
  hashPassword,
  hashToken,
  randomCsrfToken,
  randomSessionToken,
  tokensEqual,
  verifyPassword,
} from "../src/common/crypto";

describe("crypto", () => {
  it("hashes and verifies passwords", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a unique salt per hash", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same-password", a)).toBe(true);
    expect(verifyPassword("same-password", b)).toBe(true);
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(verifyPassword("anything", "scrypt$zz$zz")).toBe(false);
  });

  it("hashes tokens deterministically with SHA-256", () => {
    expect(hashToken("abc123")).toBe(hashToken("abc123"));
    expect(hashToken("abc123")).not.toBe(hashToken("abc124"));
    expect(hashToken("abc123")).toHaveLength(64);
  });

  it("generates random session and csrf tokens", () => {
    const session = randomSessionToken();
    const csrf = randomCsrfToken();
    expect(session).toHaveLength(43);
    expect(csrf).toHaveLength(32);
    expect(session).not.toBe(randomSessionToken());
  });

  it("compares tokens in constant time and rejects mismatches", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", undefined)).toBe(false);
    expect(tokensEqual("abc", "ab")).toBe(false);
  });
});