import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import "./redesign-prototype.css";
import "./redesign-adapter.css";
import "leaflet/dist/leaflet.css";
import { ServiceWorker } from "@/components/service-worker";
import { Analytics } from "@vercel/analytics/next";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "Search ID | Tower Operations",
  description: "Search ID: tower site lookup and fueling operations",
  applicationName: "Search ID",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Search ID" },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={roboto.variable}>
        <ServiceWorker />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
