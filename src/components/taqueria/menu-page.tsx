"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/order-types";
import { useOrder } from "./order-provider";
import { Catalog } from "./catalog";
import { DemoNotice, OrderFeedback, Price, ProductImage } from "./shared";

export function MenuPage() {
  const { menu, menuLoading, menuError, cart, add, pending, issue } = useOrder();
  const [reference, setReference] = useState<string | null>(null), [badFragment, setBadFragment] = useState(false), [focusRequest, setFocusRequest] = useState(0);
  const selectedHeading = useRef<HTMLHeadingElement>(null), invalidHeading = useRef<HTMLHeadingElement>(null);
  const readReference = useCallback(() => {
    const url = new URL(window.location.href), hash = new URLSearchParams(url.hash.slice(1));
    setReference(hash.has("producto") ? hash.get("producto")! : url.searchParams.has("producto") ? url.searchParams.get("producto")! : null);
    const unknown = !!url.hash && !hash.has("producto") && !["#carta", "#carta-titulo", "#contenido", "#destacado"].includes(url.hash);
    setBadFragment(unknown);
    if (url.hash || url.searchParams.has("producto")) setFocusRequest(n => n + 1);
  }, []);
  useEffect(() => { let live = true; queueMicrotask(() => { if (live) readReference(); }); window.addEventListener("popstate", readReference); window.addEventListener("hashchange", readReference); return () => { live = false; window.removeEventListener("popstate", readReference); window.removeEventListener("hashchange", readReference); }; }, [readReference]);
  const selected = menu?.products.find(p => p.id === (reference === null ? "taco-al-pastor" : reference));
  const invalid = !!menu && (!selected || badFragment);
  useEffect(() => {
    if (!focusRequest || !menu) return;
    if (invalid) invalidHeading.current?.focus();
    else if (["#carta", "#carta-titulo"].includes(window.location.hash)) document.getElementById("carta-titulo")?.focus();
    else selectedHeading.current?.focus({ preventScroll: true });
  }, [focusRequest, menu, invalid, selected?.id]);
  const choose = (product: Product) => {
    const url = new URL(window.location.href); url.hash = `producto=${product.id}`;
    window.history.pushState(null, "", url); setReference(product.id); setBadFragment(false); setFocusRequest(n => n + 1);
    document.getElementById("destacado")?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  return <main id="contenido" className="page-shell menu-page"><DemoNotice />
    <div className="menu-board">
    <section className="menu-poster" aria-label="Producto destacado" id="destacado"><div className="poster-banner"><span className="banner-dot" /><span>Nuestro destacado</span><span className="banner-dot" /></div>
      {(!menu || menuLoading && !selected) && <div className="poster-loading" role="status">{menuError ? "El menú todavía no está disponible" : "Preparando el menú…"}</div>}
      {invalid && <div className="invalid-product"><h1 ref={invalidHeading} tabIndex={-1}>No encontramos ese producto</h1><p role="alert">La referencia no corresponde a un producto del menú. Elige uno para continuar.</p><div className="button-row">{menu?.products.map(product => <Button key={product.id} className="action secondary" onClick={() => choose(product)}>Elegir {product.name}</Button>)}</div></div>}
      {selected && !invalid && <><div className="featured-scene"><span className="scene-caption">Tacos, color<br />y mucho antojo.</span><ProductImage key={selected.resource.path} resource={selected.resource} name={selected.name} eager /><span className="scene-caption scene-caption-right">Tú eliges.<br />Nosotros lo guardamos.</span></div><div className="featured-edge"><div className="featured-copy"><h1 ref={selectedHeading} tabIndex={-1}>{selected.name}</h1><p>{selected.description}</p></div><Price cents={selected.priceCents} /><div className="featured-actions"><Button className="action primary-cta" disabled={pending || !!issue || !!cart && cart.status !== "open"} onClick={() => void add(selected, true)}>{pending ? "Guardando…" : "Armar mi pedido"}<ShoppingBag size={20} /></Button><span>Añadimos 1 unidad y seguimos a tu pedido.</span></div></div></>}
    </section>
    <OrderFeedback />
    {cart && cart.status !== "open" && <div className="closed-banner"><p>Tu pedido de ejemplo está guardado.</p><Link className="text-link" href="/pedido">Ver pedido o empezar uno nuevo <ArrowRight size={18} /></Link></div>}
    <div className="menu-bridge"><span>Para todos los antojos</span><a href="#carta" onClick={event => { event.preventDefault(); if (window.location.hash !== "#carta") window.history.pushState(null, "", "#carta"); document.getElementById("carta-titulo")?.focus(); }} aria-label="Ver nuestro menú"><ArrowDown size={20} /></a></div>
    <Catalog selectedId={invalid ? undefined : selected?.id} choose={choose} />
    <div className="menu-closing"><span>¿Ya tienes tus favoritos?</span><Link href="/pedido">Revisa tu pedido <ArrowRight size={20} /></Link></div>
    </div>
  </main>;
}
