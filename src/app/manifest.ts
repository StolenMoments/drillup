import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "drillup",
    short_name: "drillup",
    description: "개인용 문제은행",
    start_url: "/",
    display: "standalone",
    background_color: "#eff4f9",
    theme_color: "#eff4f9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
