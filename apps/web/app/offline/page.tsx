import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

export default function OfflinePage() {
  return (
    <main className="home">
      <BrandLogo size={72} />
      <div className="hero">
        <h1>You are offline</h1>
        <p className="purpose">
          MazingiraOps needs a connection to load live data. Reconnect and try again — your
          reports and check-in links will resume automatically.
        </p>
      </div>
      <div className="home-actions">
        <Link href="/" className="primary-btn">
          Try again
        </Link>
      </div>
    </main>
  );
}