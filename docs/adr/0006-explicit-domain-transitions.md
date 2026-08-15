# ADR-0006 — Explicit domain transition services (no workflow engine)

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy app mutates statuses with string assignments scattered across
routes. The rewrite must make state transitions explicit and auditable.

## Decision

Implement small explicit domain transition services for absence requests and
work logs with defined allowed transitions. No workflow engine, no arbitrary
status mutation. Corrections bump a `version` and are audited.

## Consequences

- Absence: PLANNED→SUBMITTED|CANCELLED; SUBMITTED→APPROVED|REJECTED|CANCELLED;
  APPROVED/REJECTED/CANCELLED terminal (except explicit correction).
- Work log: SUBMITTED→APPROVED|REJECTED.
- State-safety tests cover invalid transitions.
