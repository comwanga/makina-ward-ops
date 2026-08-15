import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

export default function Home() {
  return (
    <main className="home">
      <section className="hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>Makina Ward Environment Operations</h1>
        <p className="subtitle">
          Multi-ward operations platform — Makina Ward · Kibra Subcounty ·
          Nairobi City County
        </p>
        <p className="status-badge">Phase 2 · Organisation + Authentication</p>
        <p className="auth-link">
          <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
