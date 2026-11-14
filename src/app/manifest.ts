import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fuel Ops",
    short_name: "Fuel Ops",
    description: "Tower fueling site lookup and operations",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#176b5b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
