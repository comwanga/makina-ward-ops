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
        <p className="status-badge">Phase 1 · Foundation</p>
      </section>
    </main>
  );
}
