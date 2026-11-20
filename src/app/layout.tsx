import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import "./redesign-prototype.css";
import "./redesign-adapter.css";
import { ServiceWorker } from "@/components/service-worker";
import { Analytics } from "@vercel/analytics/next";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "Fuel Ops",
  description: "Tower fueling site lookup and operations",
  applicationName: "Fuel Ops",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Fuel Ops" },
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
