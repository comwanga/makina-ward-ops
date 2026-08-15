# ADR-0004 — Private S3-compatible object storage for evidence

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy app stores uploads on the container filesystem, causing the
"database metadata survives + filesystem disappears = broken evidence"
failure class.

## Decision

Store all evidence/documents as private objects in S3-compatible storage with
metadata in PostgreSQL. Opaque/random keys, no permanent public URLs, access
via authorized application logic or short-lived signed URLs. Compensating
cleanup + reconciliation for partial failures.

## Consequences

- Evidence survives redeployment.
- Upload pipeline adds validation, orientation normalization, resize,
  compression before upload.
- Medical documents are private and auditable.
