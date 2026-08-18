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
        <p className="auth-link">
          <Link href="/login">Sign in</Link> · <Link href="/register">Request access</Link>
        </p>
        <p className="auth-link">
          <Link href="/staff">Staff register</Link> · <Link href="/attendance">Attendance</Link> ·{" "}
          <Link href="/absences">Absences</Link> · <Link href="/worklogs">Work logs</Link> ·{" "}
          <Link href="/reports">Reports</Link> · <Link href="/audit">Audit</Link>
        </p>
        <p className="auth-link">
          <Link href="/setup">System owner setup</Link>
        </p>
      </section>
    </main>
  );
}
