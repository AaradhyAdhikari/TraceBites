import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceBites",
  description: "Verifiable provenance for agricultural produce, from field to shelf.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#4c6b30",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
