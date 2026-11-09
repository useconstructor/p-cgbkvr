"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, ChevronDown, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { money, request, validQuantity } from "@/lib/order-client";
import type { Cart, Order } from "@/lib/order-types";
import { useOrder } from "./order-provider";
import { Catalog } from "./catalog";
import { containTab, DemoNotice, LinesSummary, OrderFeedback, Price, ProductImage } from "./shared";

function revealQuantityContext(input: HTMLInputElement) {
  const editor = input.closest(".order-editor"), field = input.closest(".editable-line");
  if (!editor || !field) return;
  const fieldBounds = field.getBoundingClientRect();
  const visualViewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportBottom = visualViewportTop + (window.visualViewport?.height ?? window.innerHeight);
  const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
  const viewportTop = Math.max(visualViewportTop, headerBottom);
  const padding = 16;
  let top = fieldBounds.top;
  // Keep nearby explanations with the focused field when they fit. Longer orders
  // retain ordinary scrolling, with the complete active field below the header.
  for (const notice of editor.querySelectorAll(".recovery-panel, .validation-summary")) {
    top = Math.min(top, notice.getBoundingClientRect().top);
  }
  if (fieldBounds.bottom - top > viewportBottom - viewportTop - padding * 2) top = fieldBounds.top;
  if (top < viewportTop + padding || fieldBounds.bottom > viewportBottom - padding) {
    window.scrollBy({ top: top - viewportTop - padding, behavior: "instant" });
  }
}

function ResourceDetails({ order }: { order: Order }) {
  return <details className="resource-details"><summary>Detalles del pedido y sus ilustraciones</summary><p>Pedido {order.id}</p><p>Guardado el {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.createdAt))}</p><p>Presentación {order.presentationVersion} · Carrito {order.cartId} · Versión {order.cartVersion}</p>{order.lines.map(line => <div key={line.productId}><strong>{line.name}</strong><p>Ilustración {line.resource.id} · Versión {line.resource.version} · Presentación {line.resource.presentationVersion}</p><a href={line.resource.path} target="_blank" rel="noreferrer">Abrir ilustración guardada</a><p className="resource-hash">SHA256: {line.resource.sha256}</p></div>)}</details>;
}
function SavedHistory({ currentId }: { currentId?: string }) {
  const { latestOrder } = useOrder();
  const [open, setOpen] = useState(false), [orders, setOrders] = useState<Order[] | null>(null), [detail, setDetail] = useState<Order | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [retryKind, setRetryKind] = useState<string | null>(null);
  const load = async (id?: string) => {
    setLoading(true); setError(""); setRetryKind(id || null);
    try { if (id) setDetail((await request<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`)).order); else setOrders((await request<{ orders: Order[] }>("/api/orders")).orders); }
    catch { setError("No pudimos recuperar los pedidos guardados. Vuelve a intentarlo."); }
    finally { setLoading(false); }
  };
  useEffect(() => { let live = true; queueMicrotask(() => { if (live && open) void load(); }); return () => { live = false; }; }, [latestOrder?.id, open]);
  return <section className="order-history" aria-label="Historial de pedidos"><Button variant="ghost" className="history-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Historial de pedidos <ChevronDown size={18} /></Button>{open && <div className="history-content">{loading && <p role="status">Cargando pedidos guardados…</p>}{error && <div className="recovery-panel"><p role="alert">{error}</p><Button className="action secondary" onClick={() => void load(retryKind || undefined)}>Reintentar historial</Button></div>}{orders && !orders.length && <p>Todavía no hay pedidos guardados.</p>}<ul>{orders?.map(order => <li className="history-row" key={order.id}><span>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.createdAt))}<span className="history-selection">{order.lines.map(line => `${line.quantity} × ${line.name}`).join(" · ")}</span><small>{order.totalUnits} unidades{order.id === currentId ? " · Pedido actual" : ""}</small></span><Price cents={order.totalCents} /><Button className="action secondary" aria-label={`Abrir pedido ${order.id}`} disabled={loading} onClick={() => void load(order.id)}>Abrir</Button></li>)}</ul>{detail && <article className="history-detail" aria-label="Detalle del pedido guardado"><h3>Pedido guardado</h3><div className="history-scene">{detail.lines.map(line => <ProductImage key={`${detail.id}:${line.productId}`} resource={line.resource} name={line.name} />)}</div><LinesSummary lines={detail.lines} /><p>Total <Price cents={detail.totalCents} /></p><ResourceDetails order={detail} /><Button className="action secondary" onClick={() => setDetail(null)}>Cerrar detalle</Button></article>}</div>}</section>;
}

export function OrderPage() {
  const store = useOrder();
  const { cart, latestOrder, loading, pending, issue, resetEpoch, initialize, mutate, refresh } = store;
  const [mode, setMode] = useState<"edit" | "review">("edit"), [reviewVersion, setReviewVersion] = useState<number | null>(null);
  const [raw, setRaw] = useState<Record<string, string>>({}), [revision, setRevision] = useState(0), [boundary, setBoundary] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState(false), [focusTarget, setFocusTarget] = useState<{ id: string; tick: number } | null>(null), [catalogOpen, setCatalogOpen] = useState(false), [newDialog, setNewDialog] = useState(false), [reviewBusy, setReviewBusy] = useState(false), [reviewError, setReviewError] = useState("");
  const [fragment, setFragment] = useState(""), fragmentError = useRef<HTMLHeadingElement>(null);
  const poster = useRef<HTMLElement>(null);
  const dirty = useRef(new Set<string>()), rawRef = useRef(raw), inputs = useRef(new Map<string, HTMLInputElement>()), cartRef = useRef(cart), lastReset = useRef(resetEpoch), reviewHeading = useRef<HTMLHeadingElement>(null), savedHeading = useRef<HTMLHeadingElement>(null), newTrigger = useRef<HTMLButtonElement>(null), previousCartId = useRef<string | null>(null);
  const focusQuantity = useCallback((id: string) => {
    const input = inputs.current.get(id);
    if (!input) return;
    input.focus({ preventScroll: true });
    revealQuantityContext(input);
  }, []);
  useEffect(() => { rawRef.current = raw; cartRef.current = cart; }, [raw, cart]);
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    const read = () => setFragment(window.location.hash);
    queueMicrotask(read); window.addEventListener("hashchange", read); window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, []);
  const unknownFragment = !!fragment && fragment !== "#contenido" && !cart?.lines.some(line => fragment === `#cantidad-${line.productId}`);
  useEffect(() => {
    if (unknownFragment) fragmentError.current?.focus();
    else if (fragment.startsWith("#cantidad-")) focusQuantity(fragment.slice("#cantidad-".length));
  }, [unknownFragment, fragment, cart?.id, focusQuantity]);
  useEffect(() => {
    if (lastReset.current !== resetEpoch) { dirty.current.clear(); lastReset.current = resetEpoch; setMode("edit"); setSummary(false); }
    if (!cart) return;
    if (previousCartId.current && previousCartId.current !== cart.id) {
      dirty.current.clear(); setMode("edit"); setSummary(false); setReviewVersion(null);
      setNewDialog(false); setCatalogOpen(cart.status === "open"); setBoundary({}); setReviewError("");
    }
    previousCartId.current = cart.id;
    setRaw(previous => {
      const next: Record<string, string> = {};
      for (const line of cart.lines) next[line.productId] = dirty.current.has(line.productId) ? previous[line.productId] ?? String(line.quantity) : String(line.quantity);
      return next;
    });
    if (mode === "review" && reviewVersion !== null && cart.version !== reviewVersion && cart.status === "open") { setMode("edit"); setReviewError("El pedido cambió. Revisa los valores actuales antes de confirmar."); }
  }, [cart, resetEpoch, mode, reviewVersion]);
  const errors = (cart?.lines || []).filter(line => !validQuantity(raw[line.productId] ?? String(line.quantity)));
  useEffect(() => { if (focusTarget) focusQuantity(focusTarget.id); }, [focusTarget, summary, focusQuantity]);
  useEffect(() => {
    if (mode === "review") {
      reviewHeading.current?.focus({ preventScroll: true });
      poster.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [mode]);
  useEffect(() => { if (cart?.status === "confirmed") savedHeading.current?.focus({ preventScroll: true }); }, [cart?.status]);
  const update = useCallback((id: string, value: string) => {
    dirty.current.add(id); setRaw(previous => ({ ...previous, [id]: value })); rawRef.current = { ...rawRef.current, [id]: value }; setRevision(n => n + 1); setBoundary(previous => ({ ...previous, [id]: "" })); setReviewError("");
  }, []);
  useEffect(() => {
    if (!cart || cart.status !== "open" || pending || issue || mode !== "edit" || reviewBusy) return;
    const timer = window.setTimeout(async () => {
      const line = cart.lines.find(line => dirty.current.has(line.productId) && validQuantity(rawRef.current[line.productId] || "") && Number(rawRef.current[line.productId]) !== line.quantity);
      if (!line) return;
      const submitted = rawRef.current[line.productId];
      const result = await mutate("/api/cart/items", { productId: line.productId, mode: "set", quantity: Number(submitted) });
      if (result && rawRef.current[line.productId] === submitted) dirty.current.delete(line.productId);
      if (result) setRevision(n => n + 1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cart, revision, pending, issue, mode, reviewBusy, mutate]);
  const step = (id: string, delta: number) => {
    const value = rawRef.current[id] ?? String(cart?.lines.find(line => line.productId === id)?.quantity || 1);
    if (!validQuantity(value)) { setBoundary(prev => ({ ...prev, [id]: "Escribe un número entero del 1 al 20" })); return; }
    const next = Number(value) + delta;
    if (next < 1 || next > 20) { setBoundary(prev => ({ ...prev, [id]: next > 20 ? "Puedes elegir hasta 20 unidades de este producto. La cantidad sigue en 20." : "La cantidad mínima es 1. Usa Quitar para eliminar el producto." })); return; }
    update(id, String(next));
  };
  const review = async () => {
    setSummary(true); setReviewError("");
    const invalid = cartRef.current?.lines.find(line => !validQuantity(rawRef.current[line.productId] ?? String(line.quantity)));
    if (invalid) { setFocusTarget({ id: invalid.productId, tick: Date.now() }); return; }
    if (!cartRef.current?.lines.length || issue || pending) return;
    setReviewBusy(true);
    try {
      let current: Cart = cartRef.current;
      for (const line of current.lines) {
        const value = rawRef.current[line.productId] ?? String(line.quantity);
        if (Number(value) !== line.quantity) {
          const result = await mutate("/api/cart/items", { productId: line.productId, mode: "set", quantity: Number(value) });
          if (!result) return;
          current = result.cart; dirty.current.delete(line.productId);
        }
      }
      const authoritative = await refresh(current);
      if (!authoritative) return;
      if (authoritative.id !== current.id || authoritative.version !== current.version) { setReviewError("Tu pedido cambió en otra vista. Comprueba los valores actuales y vuelve a revisar."); return; }
      if (!authoritative.lines.length || authoritative.status !== "open") return;
      setReviewVersion(authoritative.version); setSummary(false); setMode("review");
    } finally { setReviewBusy(false); }
  };
  const remove = async (id: string) => { const result = await mutate("/api/cart/remove", { productId: id }); if (result) { dirty.current.delete(id); setRevision(n => n + 1); } };
  const startNew = async (replaceDraft = false) => {
    const result = await mutate("/api/cart/new", { replaceDraft });
    if (result) { dirty.current.clear(); setRaw({}); setMode("edit"); setSummary(false); setReviewVersion(null); setNewDialog(false); setCatalogOpen(true); setBoundary({}); setReviewError(""); }
  };
  const saved = cart?.status === "confirmed" && latestOrder?.id === cart.orderId ? latestOrder : null;
  const displayLines = saved?.lines || cart?.lines || [];
  const hasEdits = cart?.lines.some(line => raw[line.productId] !== undefined && raw[line.productId] !== String(line.quantity));
  const totalLabel = errors.length ? "Último cálculo válido" : pending || issue || hasEdits ? "Último total guardado" : "Total";
  const feedback = <OrderFeedback localLines={cart?.lines.map(line => ({ productId: line.productId, name: line.name, quantity: raw[line.productId] ?? String(line.quantity) }))} />;
  const inlineRecovery = !!issue && !!cart && !saved && displayLines.length > 0 && !newDialog;
  const newButton = <Button ref={newTrigger} className="action secondary" disabled={pending || !!issue} onClick={() => { if (cart?.status === "open" && cart.lines.length) setNewDialog(true); else void startNew(); }}>Nuevo pedido <Plus size={17} /></Button>;
  return <main id="contenido" className="page-shell order-page"><div className="order-intro"><Link className="back-link" href="/"><ArrowLeft size={17} />Volver al menú</Link><h1 tabIndex={-1}>Mi pedido</h1><DemoNotice /></div>
    {unknownFragment && <section className="recovery-panel"><h2 ref={fragmentError} tabIndex={-1}>No encontramos esa sección</h2><p role="alert">Puedes volver al comienzo de tu pedido o consultar el menú.</p><div className="button-row"><a className="text-link" href="#contenido" onClick={() => setFragment("#contenido")}>Volver a mi pedido</a><Link className="text-link" href="/">Volver al menú</Link></div></section>}
    {loading && !cart && <div className="order-poster order-loading" role="status"><ShoppingBag size={40} /><p>Recuperando tu pedido…</p></div>}
    {!loading && !cart && !issue && <div className="recovery-panel"><p role="alert">Tu pedido todavía no está disponible.</p><Button className="action" onClick={() => void initialize()}>Reintentar</Button></div>}
    {!newDialog && !inlineRecovery && feedback}
    {cart && <section ref={poster} className={`order-poster ${saved ? "is-saved" : mode === "review" ? "is-review" : "is-edit"} ${!displayLines.length ? "is-empty" : displayLines.length === 1 ? "has-single" : "has-multiple"}`}>
      <div className="poster-banner"><span>{saved ? "Tu selección, guardada" : mode === "review" ? "Un último vistazo" : "A tu gusto"}</span></div>
      <section className={`selection-scene selection-${!displayLines.length ? "empty" : displayLines.length === 1 ? "single" : "multiple"}`} aria-label="Selección del pedido" data-cart-id={cart.id} data-cart-version={cart.version}>
        {displayLines.length ? displayLines.map(line => <div key={`${line.productId}:${line.resource.path}`} className="selected-reference" role="group" aria-label={line.name}><ProductImage resource={line.resource} name={line.name} eager /><span className="selection-name">{line.name}</span></div>) : <div className="empty-selection"><img src="/brand-mark.svg" alt="" width="100" height="100" /><h2>Tu pedido empieza con un antojo</h2><p>Añade tus tacos y bebidas favoritos.</p></div>}
      </section>
      {saved ? <section className="saved-specification" aria-label="Pedido guardado"><h2 ref={savedHeading} tabIndex={-1}><Check aria-hidden="true" />Pedido de ejemplo guardado</h2><p>No se ha cobrado ni enviado a una cocina.</p><LinesSummary lines={saved.lines} /><div className="saved-total"><span>Total guardado</span><Price cents={saved.totalCents} /></div><div className="button-row">{newButton}<Link className="text-link" href="/">Volver al menú <ArrowRight size={18} /></Link></div><ResourceDetails order={saved} /></section>
      : mode === "review" ? <section className="review-specification" aria-label="Revisión del pedido"><h2 ref={reviewHeading} tabIndex={-1}>Revisa tu pedido</h2><p>Comprueba tu selección antes de guardarla.</p><LinesSummary lines={displayLines} /><div className="saved-total"><span>Total</span><Price cents={cart.totalCents} /></div>{inlineRecovery && feedback}<Button className="action primary-cta" disabled={pending || !!issue || !cart.lines.length} onClick={() => void mutate("/api/orders")}>{pending ? "Guardando…" : "Confirmar pedido de ejemplo"}{pending ? <Clock3 size={20} aria-hidden="true" /> : <Check size={20} aria-hidden="true" />}</Button><Button className="action secondary" disabled={pending} onClick={() => setMode("edit")}>Seguir editando</Button></section>
      : <><div className="order-action-edge"><div><span>{totalLabel}</span><Price cents={cart.totalCents} /></div>{cart.lines.length ? <Button className="action primary-cta" disabled={pending || !!issue || reviewBusy} onClick={() => void review()}>{reviewBusy ? "Comprobando…" : "Revisar pedido"}<ArrowRight size={19} /></Button> : <Button className="action primary-cta" disabled={!!issue} onClick={() => setCatalogOpen(true)}>Añadir productos<Plus size={19} /></Button>}</div>
        {!!displayLines.length && <form className="order-editor" aria-label="Edición del pedido" onSubmit={event => { event.preventDefault(); void review(); }}>
          <h2 className="sr-only">Así lo quieres</h2>
          {inlineRecovery && feedback}
          {summary && errors.length > 0 && <div className="validation-summary" role="alert"><h3>Revisa las cantidades</h3><p>Escribe un número entero del 1 al 20.</p><ul>{errors.map(line => <li key={line.productId}><a href={`#cantidad-${line.productId}`} onClick={e => { e.preventDefault(); focusQuantity(line.productId); }}>{line.name}: corregir cantidad</a></li>)}</ul></div>}
          {reviewError && <p role="alert" className="field-error">{reviewError}</p>}
          {displayLines.map(line => {
            const value = raw[line.productId] ?? String(line.quantity), invalid = !validQuantity(value), error = invalid ? "Escribe un número entero del 1 al 20" : boundary[line.productId];
            const unconfirmed = invalid || pending || !!issue || value !== String(line.quantity);
            return <fieldset className="editable-line" key={line.productId} data-product-id={line.productId}><legend className="sr-only">{line.name}</legend><div className="line-fields"><div className="line-identity"><h3 aria-hidden="true">{line.name}</h3><span className="line-unit">{money(line.unitPriceCents)} MXN c/u</span></div><Button type="button" variant="ghost" className="remove-button" aria-label={`Quitar ${line.name}`} disabled={pending || !!issue || reviewBusy} onClick={() => void remove(line.productId)}><Trash2 size={15} />Quitar</Button><div className="line-controls"><div className="quantity-field"><label htmlFor={`cantidad-${line.productId}`}>Cantidad <small>(1–20)</small></label><div className="quantity-stepper"><Button type="button" variant="ghost" aria-label={`Reducir cantidad de ${line.name}`} onClick={() => step(line.productId, -1)} disabled={reviewBusy}><Minus size={17} /></Button><input ref={element => { if (element) inputs.current.set(line.productId, element); else inputs.current.delete(line.productId); }} id={`cantidad-${line.productId}`} aria-label={`Cantidad de ${line.name}`} type="text" inputMode="numeric" value={value} aria-invalid={invalid} aria-describedby={error ? `error-${line.productId}` : undefined} onFocus={e => revealQuantityContext(e.currentTarget)} onChange={e => update(line.productId, e.target.value)} disabled={reviewBusy} /><Button type="button" variant="ghost" aria-label={`Aumentar cantidad de ${line.name}`} onClick={() => step(line.productId, 1)} disabled={reviewBusy}><Plus size={17} /></Button></div></div><div className="line-subtotal"><span>{unconfirmed ? "Último subtotal confirmado" : "Subtotal"}</span><Price cents={line.subtotalCents} />{unconfirmed && <small>{line.quantity} {line.quantity === 1 ? "unidad confirmada" : "unidades confirmadas"}</small>}</div></div></div>{error && <p id={`error-${line.productId}`} className="field-error" role="alert">{error}</p>}</fieldset>;
          })}
        </form>}
      </>}
    </section>}
    {cart && !saved && mode === "edit" && <div className="order-secondary-actions">{cart.lines.length > 0 && <Button className="action secondary" aria-expanded={catalogOpen} onClick={() => setCatalogOpen(!catalogOpen)}>Añadir productos <Plus size={18} /></Button>}{cart.lines.length > 0 && newButton}</div>}
    {catalogOpen && cart?.status === "open" && mode === "edit" && <div className="order-catalog"><Button className="action secondary" onClick={() => setCatalogOpen(false)}>Cerrar catálogo</Button><Catalog compact /></div>}
    {cart && <SavedHistory currentId={saved?.id} />}
    <Dialog open={newDialog} onOpenChange={setNewDialog}><DialogTrigger className="hidden" tabIndex={-1} aria-hidden="true" /><DialogContent className="brand-dialog" showCloseButton={false} onKeyDown={containTab} finalFocus={newTrigger}><DialogTitle>Empezar un nuevo pedido</DialogTitle><DialogDescription>Tu selección actual se reemplazará por un pedido vacío. Los pedidos que ya guardaste seguirán en el historial.</DialogDescription><OrderFeedback localLines={cart?.lines.map(line => ({ productId: line.productId, name: line.name, quantity: raw[line.productId] ?? String(line.quantity) }))} /><DialogClose render={<Button className="action secondary" disabled={pending} />}>Cancelar</DialogClose><Button className="action" disabled={pending || !!issue} onClick={() => void startNew(true)}>{pending ? "Guardando…" : "Empezar nuevo pedido"}</Button></DialogContent></Dialog>
  </main>;
}
