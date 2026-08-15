# Branding

Approved branding assets supplied for the rewrite. These replace the legacy
placeholder "NCC" text seal and provide the persistent application background.

## Assets

| File | Dimensions | Use |
|---|---|---|
| `branding/nairobi-city-county-logo.png` | 320×320 (8-bit colormap) | Official logo in all documents, reports, QR sign-in, login/setup/register, dashboard, account pages |
| `branding/nairobi-green-corridor.png` | 1536×1024 (RGB) | Persistent background canvas behind the application |

## Placement in the new monorepo

- Source of truth: `branding/` (this directory).
- Runtime copies: `apps/web/public/branding/` (served statically by Next.js).
- Referenced only through two shared components so the assets can be swapped
  without editing individual screens:
  - `BrandLogo` (renders `nairobi-city-county-logo.png`)
  - `BrandBackground` (renders `nairobi-green-corridor.png`)

## Where the logo must appear

- Login, owner setup, register, and check-in (QR sign-in) screens.
- Dashboard sidebar / application brand.
- Report headers (HTML, print/PDF) and CSV/XLSX exports where a logo is
  appropriate.
- Any account/administration chrome that currently shows the "NCC" seal.

## Where the background must appear

- Persistent, low-opacity background canvas behind all authenticated and
  public pages (dimmable overlay to preserve text legibility).
- Respect `prefers-reduced-motion`/print (background hidden in print).

## Notes

- `theme-color` and accent colors stay consistent with the approved palette.
- Branding is data/config, consistent with the principle that "Makina is
  data, not hard-coded architecture".
