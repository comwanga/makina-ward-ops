# ADR-0007 — Immutable reports with one deterministic aggregation engine

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy app finalizes reports as JSON snapshots but duplicates aggregation
logic and has no multi-level hierarchy.

## Decision

One reusable deterministic aggregation engine (ward → subcounty → county).
Finalized reports persist an immutable factual snapshot (including evidence
ID/object key/SHA-256/caption/stage) plus narrative, recommendations, version,
finalizedBy/finalizedAt, scope, period. AI never computes authoritative totals.

## Consequences

- No duplicate report engines per level.
- Reports do not silently change when source records change post-finalization.
- Exports: HTML/print PDF, CSV/XLSX.
