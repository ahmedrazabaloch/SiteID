import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Search ID — Tower Operations",
    short_name: "Search ID",
    description: "Offline-ready tower site lookup and fueling operations",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#176b5b",
    orientation: "any",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
