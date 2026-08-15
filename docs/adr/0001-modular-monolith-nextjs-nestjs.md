# ADR-0001 — Modular monolith: Next.js + NestJS

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy FastAPI application mixes presentation, business rules, and data
access. The rewrite must support multiple wards/subcounties under one
deployment without microservices.

## Decision

A single monorepo with two deployable apps (`apps/web` Next.js presentation,
`apps/api` NestJS/Fastify authoritative business logic) and shared packages.
A modular monolith, not microservices.

## Consequences

- One repo, two deployables (web + api) plus PostgreSQL and S3.
- Clear boundary: no business logic in Next.js.
- Shared `contracts`/`validation` packages reduce drift.
- No Kubernetes, service mesh, or service-to-service orchestration.
