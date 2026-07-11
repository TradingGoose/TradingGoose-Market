import localFont from "next/font/local";

export const soehne = localFont({
  src: [
    { path: "./soehne-leicht.woff2", weight: "300", style: "normal" },
    { path: "./soehne-buch.woff2", weight: "400", style: "normal" },
    { path: "./soehne-kraftig.woff2", weight: "500", style: "normal" },
    { path: "./soehne-halbfett.woff2", weight: "600", style: "normal" }
  ],
  display: "swap",
  preload: false,
  variable: "--font-soehne",
  fallback: [
    "system-ui",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "Noto Sans"
  ],
  adjustFontFallback: "Arial"
});
