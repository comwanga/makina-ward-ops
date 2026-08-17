# ADR-0002 — PostgreSQL + Prisma

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy app uses SQLAlchemy with SQLite locally and PostgreSQL in
production, with `create_all` and ad-hoc `ALTER TABLE` migrations.

## Decision

Single PostgreSQL datastore with Prisma owning schema, migrations, typed
client, relations, and constraints.

## Consequences

- Reproducible migration history (no `create_all`, no ad-hoc ALTERs).
- Database constraints enforce critical invariants (unique employee number
  per ward, unique attendance employee/date, unique object keys).
- No MongoDB/DynamoDB, no per-ward databases.
