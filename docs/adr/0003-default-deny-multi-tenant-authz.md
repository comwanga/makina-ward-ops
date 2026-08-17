# ADR-0003 — Default-deny multi-tenant authorization

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy app encodes "Makina" as an implicit single ward and uses
`User.role` plus a CSV `permissions` string. Empty permissions erroneously
grant full access (fail-open).

## Decision

Model `User → Assignment(role, scopeType, scopeId)` with a central capability
set. Evaluation = user + role + assignment scope + requested resource scope +
required capability. Default **DENY**. Client-supplied scope IDs are never
trusted; backend filters every query by resolved assignment scope.

## Consequences

- Corrects the legacy fail-open behavior.
- Central guards/policies, not per-controller checks.
- Enables Makina → Kibra → county-wide without per-ward deployments.
- Release-critical cross-tenant isolation tests required.
