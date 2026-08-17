import { BRANDING } from "@/lib/branding";

export function BrandBackground() {
  return (
    <div
      className="brand-background"
      style={{ backgroundImage: `url(${BRANDING.background})` }}
      aria-hidden="true"
    />
  );
}
