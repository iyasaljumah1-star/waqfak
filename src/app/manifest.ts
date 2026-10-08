import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "وقفك — خدمات الأوقاف",
    short_name: "وقفك",
    description: "قيّم وقفك، واعرف التزاماته النظامية ومواعيدها، وابنِ له ملفًا حيًا يحفظ شرط واقفه.",
    lang: "ar",
    dir: "rtl",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f2e4d",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
