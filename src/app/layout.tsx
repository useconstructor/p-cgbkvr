import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrderProvider } from "@/components/taqueria/order-provider";
import { NavigationFocus, SiteFooter, SiteHeader } from "@/components/taqueria/shared";
import branding from "../../branding.json";
import fontAssets from "@/data/font-assets.json";

export const metadata: Metadata = {
  title: "Taquería Monterey · Menú",
  description: "Elige tacos y bebidas, arma tu pedido y guárdalo. Una demo ficticia de Esteban, con productos y precios de ejemplo.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "16x16 32x32 64x64" }] },
  referrer: "origin",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const collector = `${process.env.NEXT_PUBLIC_CONSTRUCTOR_API?.replace(/\/$/, "")}/v1/projects/${process.env.NEXT_PUBLIC_PROJECT_ID}/analytics/script.js`;
  const fonts = branding.brandbook.fontFaces.map(face => {
    const src = (fontAssets as Record<string, string>)[face.url] || face.url;
    return `@font-face{font-family:${JSON.stringify(face.family)};font-style:normal;font-weight:${face.weight};font-display:swap;src:url(${JSON.stringify(src)}) format('truetype');}`;
  }).join("\n");
  const tokens = {
    "--brand-background": branding.backgroundColor, "--brand-surface": branding.secondaryColor,
    "--brand-primary": branding.primaryColor, "--brand-accent": branding.accentColor,
    "--brand-text": branding.textColor, "--brand-font-heading": `"${branding.fontHeading}", sans-serif`,
    "--brand-font-body": `"${branding.fontBody}", sans-serif`, "--radius": branding.borderRadius,
  } as CSSProperties;
  return <html lang="es" style={tokens}><head><style>{fonts}</style></head><body><TooltipProvider><OrderProvider><NavigationFocus /><a href="#contenido" className="skip-link">Saltar al contenido</a><SiteHeader />{children}<SiteFooter /></OrderProvider></TooltipProvider><script src={"https://constructor-api-git-dev-useconstructor.vercel.app/v1/projects/P-CGBKVR/analytics/script.js"} defer></script><script src="/constructor-editor.js" defer></script></body></html>;
}
