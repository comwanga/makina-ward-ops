# ADR-0005 — Server-controlled cookie authentication

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy app uses server-side sessions with secure HttpOnly cookies and
per-session CSRF tokens. This must be preserved.

## Decision

Use server-controlled browser authentication: secure HttpOnly session cookies,
CSRF protection, session expiration/revocation, password hashing (scrypt or
Argon2), account disabling, audit events, and login throttling. No long-lived
auth secrets in `localStorage`. Do not invent a custom protocol.

## Consequences

- Preserves the legacy app's security strengths.
- Compatible with a browser-based operational system and QR check-in.
- Password hashes remain verifiable during migration (re-hash on first login).
