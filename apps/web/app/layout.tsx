import type { Metadata, Viewport } from "next";
import { BrandBackground } from "@/components/BrandBackground";
import { BRANDING } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: "Makina Ward Operations",
  description:
    "Multi-ward staff attendance and environment operations reporting",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: BRANDING.themeColor,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <BrandBackground />
        <div className="app-canvas">{children}</div>
      </body>
    </html>
  );
}
