# ADR-0008 — Approved branding assets

- **Status:** Proposed
- **Date:** 2026-08-15

## Context

The legacy UI uses a placeholder "NCC" text seal. The approved assets have
been supplied: `nairobi-city-county-logo.png` (320×320) and
`nairobi-green-corridor.png` (1536×1024 canvas background).

## Decision

- Replace the placeholder `.county-mark` "NCC" text seal with
  `nairobi-city-county-logo.png` in: login, setup, register, check-in (QR
  sign-in), dashboard sidebar/brand, account pages, and all report headers
  (HTML, print/PDF, CSV/export where a logo is appropriate).
- Use `nairobi-green-corridor.png` as the persistent application background
  canvas behind all pages (dimmable for legibility).
- Store assets under `apps/web/public/branding/` (source copies under
  `branding/`), referenced via a single `BrandLogo`/`BrandBackground`
  component so they can be swapped without touching templates.
- Keep `theme-color` consistent with the approved palette.

## Consequences

- One source of truth for branding; no hard-coded "NCC" text seal.
- Branding is configuration/data, consistent with "Makina is data".
