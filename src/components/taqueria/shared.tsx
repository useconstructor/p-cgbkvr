"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, Info, Menu as MenuIcon, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Line, Resource } from "@/lib/order-types";
import { money, validQuantity } from "@/lib/order-client";
import { useOrder } from "./order-provider";
import branding from "../../../branding.json";

export function containTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(el => el.getClientRects().length > 0 && el.getAttribute("aria-disabled") !== "true");
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
}
export function NavigationFocus() {
  const pathname = usePathname();
  useEffect(() => {
    // Keep every supplied weight ready when responsive styles refresh the font set.
    const loadFonts = () => {
      void Promise.allSettled(branding.brandbook.fontFaces.map(face => document.fonts.load(`${face.weight} 16px "${face.family}"`)));
    };
    loadFonts();
    document.fonts.addEventListener("loadingdone", loadFonts);
    window.addEventListener("resize", loadFonts);
    return () => {
      document.fonts.removeEventListener("loadingdone", loadFonts);
      window.removeEventListener("resize", loadFonts);
    };
  }, [pathname]);
  useEffect(() => {
    const focusDestination = (hash: string) => {
      const id = hash === "#carta" ? "carta-titulo" : hash.slice(1);
      const region = document.getElementById(id);
      const heading = region?.matches("h1,h2,h3") ? region : region?.querySelector<HTMLElement>("h1,h2,h3");
      if (heading instanceof HTMLElement) heading.focus();
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#']");
      if (!link || event.defaultPrevented || !["#contenido", "#carta", "#carta-titulo", "#destacado"].includes(link.hash)) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, "", link.hash);
      focusDestination(link.hash);
    };
    const onHistory = () => { if (["#contenido", "#carta", "#carta-titulo", "#destacado"].includes(location.hash)) focusDestination(location.hash); };
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHistory);
    window.addEventListener("popstate", onHistory);
    onHistory();
    return () => { document.removeEventListener("click", onClick); window.removeEventListener("hashchange", onHistory); window.removeEventListener("popstate", onHistory); };
  }, []);
  return null;
}
export function Brand({ footer = false }: { footer?: boolean }) {
  const words = branding.logoText.split(" ");
  return <Link href="/" className={`brand-lockup ${footer ? "brand-footer" : ""}`} aria-label={`${branding.logoText}, Menú`}><img data-brand-logo src={branding.logoImageUrl || "/brand-mark.svg"} alt="" width="56" height="56" /><span>{words.slice(0, -1).join(" ")}<br />{words[words.length - 1]}</span></Link>;
}
export function SiteHeader() {
  const pathname = usePathname(), { cart } = useOrder();
  const [open, setOpen] = useState(false);
  useEffect(() => { queueMicrotask(() => setOpen(false)); }, [pathname]);
  return <header className={`site-header${pathname === "/pedido" ? " order-header" : ""}`}><div className="header-inner"><Brand /><nav className="desktop-nav" aria-label="Navegación principal"><Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Menú</Link><Link href="/pedido" aria-current={pathname === "/pedido" ? "page" : undefined}>Mi pedido</Link></nav><Link className="cart-access" href="/pedido" data-cart-access><ShoppingBag aria-hidden="true" size={20} /><span>Mi pedido</span><span className="cart-count" aria-label={`${cart?.totalUnits || 0} unidades`}>{cart?.totalUnits || 0}</span></Link><Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant="outline" className="mobile-nav-trigger" aria-label="Abrir navegación" />}><MenuIcon /></DialogTrigger><DialogContent className="brand-dialog" showCloseButton={false} onKeyDown={containTab}><DialogTitle>Navegación</DialogTitle><DialogDescription>Elige dónde continuar.</DialogDescription><nav aria-label="Navegación móvil" className="mobile-links"><Link href="/" onClick={() => setOpen(false)}>Menú <ArrowRight /></Link><Link href="/pedido" onClick={() => setOpen(false)}>Mi pedido <ArrowRight /></Link></nav><DialogClose render={<Button variant="outline" className="action secondary" />}><X />Cerrar navegación</DialogClose></DialogContent></Dialog></div></header>;
}
export function SiteFooter() { return <footer className="site-footer"><div className="footer-inner"><Brand footer /><p>Elige tus favoritos.<br />Haz el pedido a tu gusto.</p><nav aria-label="Navegación del pie"><Link href="/">Menú</Link><Link href="/pedido">Mi pedido</Link></nav><span className="footer-credit">Hecho por Esteban</span></div></footer>; }
export function DemoNotice() { return <p className="demo-notice"><Info size={15} aria-hidden="true" /><span>Demo ficticia de Esteban · Productos y precios de ejemplo</span></p>; }
export function Price({ cents, className = "" }: { cents: number; className?: string }) { return <span className={`price ${className}`}>{money(cents)} <small>MXN</small></span>; }
export function ProductImage({ resource, name, eager = false }: { resource: Resource; name: string; eager?: boolean }) {
  return <ResourceImage key={`${resource.path}:${resource.sha256}:${resource.version}`} resource={resource} name={name} eager={eager} />;
}
function ResourceImage({ resource, name, eager }: { resource: Resource; name: string; eager: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  return <div className={`product-image image-${state}`} data-resource-version={resource.version} data-presentation-version={resource.presentationVersion}>
    {state !== "failed" && <img key={`${resource.path}:${attempt}`} ref={imageRef} src={resource.path} alt={`Ilustración de ${name}`} data-product-id={resource.id} width="480" height="400" loading={eager ? "eager" : "lazy"} decoding="async" onLoad={async event => { const image = event.currentTarget; try { await image.decode(); if (imageRef.current === image && image.naturalWidth > 0 && image.naturalHeight > 0) setState("ready"); } catch { if (imageRef.current === image) setState("failed"); } }} onError={() => setState("failed")} />}
    {state === "loading" && <span className="image-loading" aria-hidden="true" />}
    {state === "failed" && <div className="media-error" role="alert"><span>No se pudo cargar la ilustración</span><Button className="action secondary" onClick={() => { setState("loading"); setAttempt(n => n + 1); }}>Reintentar</Button></div>}
  </div>;
}
export function LinesSummary({ lines }: { lines: Line[] }) { return <ul className="line-summary">{lines.map(line => <li key={line.productId}><span>{line.name}<small>{line.quantity} × {money(line.unitPriceCents)} MXN</small></span><Price cents={line.subtotalCents} /></li>)}</ul>; }
export function OrderFeedback({ localLines }: { localLines?: { productId: string; name: string; quantity: string }[] }) {
  const store = useOrder();
  const { issue, pending, notice } = store;
  const localQuantity = localLines?.find(line => line.productId === issue?.intent?.payload.productId)?.quantity;
  const localInvalid = localLines?.some(line => !validQuantity(line.quantity));
  const localChanged = localLines?.some(line => Number(line.quantity) !== store.cart?.lines.find(saved => saved.productId === line.productId)?.quantity);
  if (!issue) return <div className="save-feedback" role="status" aria-live="polite">{pending ? <><span className="pending-dot" />Guardando…</> : localInvalid ? "Revisa las cantidades. Se muestra el último cálculo válido." : localChanged ? "Cambios pendientes de guardar" : notice ? <>{/añadido|Cambios guardados|Pedido de ejemplo guardado/.test(notice) && <Check size={16} />}{notice}</> : null}</div>;
  return <section className="recovery-panel" aria-label="Recuperación del pedido"><p role="alert" className="recovery-title">{issue.message}</p>
    {issue.kind === "conflict" && <><div className="conflict-values"><div><h3>Tu edición</h3>{localLines?.length ? <ul>{localLines.map((line, i) => <li key={i}>{line.name}: {line.quantity || "sin cantidad"}</li>)}</ul> : <p>{issue.intent?.product?.name || "Cambio pendiente"}{issue.intent?.payload.quantity ? ` · ${issue.intent.payload.quantity} unidad(es)` : ""}</p>}</div><div><h3>Valores actuales</h3>{issue.details?.current ? <><LinesSummary lines={issue.details.current.lines} /><p>Total: <Price cents={issue.details.current.totalCents} /></p></> : <p>Reintenta para consultar los valores actuales.</p>}</div><div><h3>Último pedido guardado</h3>{issue.details?.latestOrder ? <LinesSummary lines={issue.details.latestOrder.lines} /> : <p>Todavía no hay un pedido guardado.</p>}</div></div><div className="button-row"><Button className="action" disabled={pending || !issue.details?.current} onClick={store.useCurrent}>Usar valores actuales</Button><Button className="action secondary" disabled={pending || !issue.details?.current || !issue.intent || localInvalid} onClick={() => void store.reapply(localQuantity === undefined ? undefined : Number(localQuantity))}>Volver a aplicar mi cambio</Button></div></>}
    {issue.kind === "uncertain" && <div className="button-row"><Button className="action" disabled={pending} onClick={() => void store.check()}>Comprobar guardado</Button><Button className="action secondary" disabled={pending} onClick={() => void store.retry()}>Reintentar</Button></div>}
    {issue.kind === "session" && <><p>Permite las cookies para continuar. Al iniciar una nueva sesión, los pedidos de la sesión perdida no podrán recuperarse. Puedes seguir consultando el menú.</p><div className="button-row"><Button className="action secondary" disabled={pending || store.loading} onClick={() => void store.initialize()}>Reintentar acceso</Button><Button className="action" disabled={pending || store.loading} onClick={() => void store.initialize(true)}>Iniciar nueva sesión</Button></div></>}
    {issue.kind === "error" && <div className="button-row"><Button className="action secondary" disabled={pending} onClick={() => void store.retry()}>Reintentar</Button>{issue.intent && <Button className="action secondary" onClick={store.clearIssue}>Seguir editando</Button>}</div>}
  </section>;
}
