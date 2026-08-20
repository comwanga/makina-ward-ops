import type { Metadata, Viewport } from "next";
import { BrandBackground } from "@/components/BrandBackground";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { BRANDING } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: "MazingiraOps",
  description:
    "Multi-ward environment operations reporting",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "MazingiraOps",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: BRANDING.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <ServiceWorkerRegistration />
        <div className="app-canvas">{children}</div>
      </body>
    </html>
  );
}
