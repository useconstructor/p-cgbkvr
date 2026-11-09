"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ApiError, Cart, CartResponse, Menu, MutationResult, Order, Product } from "@/lib/order-types";
import { establishSession, post, request, RequestFailure } from "@/lib/order-client";

type Intent = { endpoint: string; payload: Record<string, unknown>; product?: Product; navigate?: boolean };
type Issue = { kind: "uncertain" | "conflict" | "error" | "session"; message: string; details?: ApiError; intent?: Intent };
type Store = {
  menu: Menu | null; menuLoading: boolean; menuError: string; loadMenu: () => Promise<void>;
  cart: Cart | null; latestOrder: Order | null; loading: boolean; pending: boolean; issue: Issue | null; notice: string; resetEpoch: number;
  initialize: (recover?: boolean) => Promise<Cart | null>; refresh: (expected?: Cart) => Promise<Cart | null>;
  mutate: (endpoint: string, fields?: Record<string, unknown>, options?: { product?: Product; navigate?: boolean }) => Promise<MutationResult | null>;
  add: (product: Product, navigate?: boolean) => Promise<MutationResult | null>;
  retry: () => Promise<void>; check: () => Promise<void>; useCurrent: () => void; reapply: (quantity?: number) => Promise<void>; clearIssue: () => void;
};
const Context = createContext<Store | null>(null);
export const useOrder = () => { const store = useContext(Context); if (!store) throw Error("OrderProvider missing"); return store; };

async function moveReference(product: Product) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const candidates = [...document.querySelectorAll<HTMLImageElement>(`img[data-product-id="${product.id}"]`)];
  const source = candidates.find(image => { const r = image.getBoundingClientRect(); return image.complete && image.naturalWidth > 0 && r.bottom > 0 && r.top < innerHeight && r.left < innerWidth && r.right > 0; });
  const target = document.querySelector<HTMLElement>("[data-cart-access]");
  if (!source || !target) return;
  const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
  const size = Math.min(from.width, from.height, 100);
  const left = Math.max(0, Math.min(innerWidth - size, from.left + (from.width - size) / 2));
  const top = Math.max(0, Math.min(innerHeight - size, from.top + (from.height - size) / 2));
  const copy = source.cloneNode() as HTMLImageElement;
  copy.removeAttribute("data-product-id"); copy.alt = ""; copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, { position: "fixed", left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px`, objectFit: "contain", pointerEvents: "none", zIndex: "80" });
  copy.setAttribute("data-addition-motion", "true"); document.body.append(copy);
  const animation = copy.animate([{ transform: "translate(0, 0) scale(1)" }, { transform: `translate(${to.left + to.width / 2 - left - size / 2}px, ${to.top + to.height / 2 - top - size / 2}px) scale(.35)` }], { duration: 200, easing: "ease-in-out", fill: "forwards" });
  try { await animation.finished; } catch { /* Interrupted animations do not invalidate a successful save. */ } finally { animation.cancel(); copy.remove(); }
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [menu, setMenu] = useState<Menu | null>(null), [menuLoading, setMenuLoading] = useState(true), [menuError, setMenuError] = useState("");
  const [cart, setCart] = useState<Cart | null>(null), [latestOrder, setLatestOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [issue, setIssue] = useState<Issue | null>(null), [notice, setNotice] = useState("");
  const [resetEpoch, setResetEpoch] = useState(0);
  const cartRef = useRef<Cart | null>(null), issueRef = useRef<Issue | null>(null), busy = useRef(false);
  const setProblem = useCallback((problem: Issue | null) => { issueRef.current = problem; setIssue(problem); }, []);
  const applyCart = useCallback((next: Cart) => { cartRef.current = next; setCart(next); }, []);
  const applyRead = useCallback((data: CartResponse) => { applyCart(data.cart); setLatestOrder(data.latestOrder); }, [applyCart]);
  const loadMenu = useCallback(async () => {
    setMenuLoading(true); setMenuError("");
    try { const data = await request<Menu>("/api/menu"); if (!Array.isArray(data.products) || !Array.isArray(data.categories) || data.products.some(p => !p.resource?.path || !Number.isSafeInteger(p.priceCents))) throw Error("Invalid menu"); setMenu(data); }
    catch { setMenuError("No pudimos cargar el menú. Reintenta para consultar productos y precios."); }
    finally { setMenuLoading(false); }
  }, []);
  useEffect(() => { let live = true; void Promise.resolve().then(() => { if (live) void loadMenu(); }); void request<CartResponse>("/api/cart").then(data => { if (live && !cartRef.current) applyRead(data); }).catch(error => { if (live && !(error instanceof RequestFailure && error.status === 401)) setNotice("El pedido todavía no está disponible. Puedes seguir consultando el menú."); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [loadMenu, applyRead]);
  const initialize = useCallback(async (recover = false) => {
    setLoading(true);
    try {
      const retainedIntent = issueRef.current?.intent;
      const data = await establishSession(recover);
      applyRead(data);
      setProblem(retainedIntent && !recover ? { kind: "uncertain", message: "Todavía no podemos confirmar el guardado. Comprueba el estado antes de hacer otro cambio.", intent: retainedIntent } : null);
      return data.cart;
    }
    catch (error) { setProblem({ kind: error instanceof RequestFailure && error.status !== 401 ? "error" : "session", message: error instanceof RequestFailure ? error.message : "No podemos acceder a tu sesión. Comprueba tu conexión y permite las cookies para volver a intentarlo." }); return null; }
    finally { setLoading(false); }
  }, [applyRead, setProblem]);
  const refresh = useCallback(async (expected?: Cart) => {
    try {
      const data = await request<CartResponse>("/api/cart");
      if (expected && (expected.id !== data.cart.id || expected.version !== data.cart.version)) {
        setProblem({ kind: "conflict", message: "Tu pedido cambió en otra vista", details: { error: { code: "VERSION_CONFLICT", message: "Vuelve a revisar el pedido." }, current: data.cart, latestOrder: data.latestOrder } });
        return null;
      }
      applyRead(data); return data.cart;
    }
    catch (error) { setProblem({ kind: error instanceof RequestFailure && error.status === 401 ? "session" : "error", message: "No pudimos recuperar tu pedido. Reintenta para comprobar los valores guardados." }); return null; }
  }, [applyRead, setProblem]);
  const success = useCallback(async (result: MutationResult, intent: Intent) => {
    applyCart(result.cart); if (result.order) setLatestOrder(result.order); setProblem(null);
    setNotice(intent.product ? `${intent.product.name} añadido. ${result.cart.totalUnits} ${result.cart.totalUnits === 1 ? "unidad" : "unidades"} en tu pedido.` : result.order ? "Pedido de ejemplo guardado" : "Cambios guardados");
    if (intent.product) await moveReference(intent.product);
    if (intent.navigate) router.push("/pedido");
  }, [applyCart, router, setProblem]);
  const send = useCallback(async (intent: Intent): Promise<MutationResult | null> => {
    busy.current = true; setPending(true); setNotice("");
    try { const result = await post<MutationResult>(intent.endpoint, intent.payload); await success(result, intent); return result; }
    catch (error) {
      if (!(error instanceof RequestFailure) || error.status >= 500) setProblem({ kind: "uncertain", message: "Todavía no podemos confirmar el guardado. Comprueba el estado antes de hacer otro cambio.", intent });
      else if (error.status === 401) setProblem({ kind: "session", message: "No podemos acceder a tu sesión. Tus cambios están en pausa; no podemos recuperar pedidos de otra sesión.", details: error.body, intent });
      else if (["VERSION_CONFLICT", "CART_CLOSED", "IDEMPOTENCY_CONFLICT"].includes(error.body.error.code)) setProblem({ kind: "conflict", message: "Tu pedido cambió en otra vista", details: error.body, intent });
      else setProblem({ kind: "error", message: Object.values(error.body.error.fieldErrors || {}).join(" ") || error.message, details: error.body, intent });
      return null;
    } finally { busy.current = false; setPending(false); }
  }, [setProblem, success]);
  const mutate = useCallback(async (endpoint: string, fields: Record<string, unknown> = {}, options?: { product?: Product; navigate?: boolean }) => {
    if (busy.current || issueRef.current) return null;
    busy.current = true;
    const current = cartRef.current || await initialize();
    if (!current) { busy.current = false; return null; }
    const intent: Intent = { endpoint, payload: Object.freeze({ cartId: current.id, expectedVersion: current.version, idempotencyKey: crypto.randomUUID(), ...fields }), ...options };
    return send(intent);
  }, [initialize, send]);
  const add = useCallback(async (product: Product, navigate = false) => {
    if (navigate && navigator.doNotTrack !== "1") (window as Window & { constructorTrack?: (event: string) => void }).constructorTrack?.("Order started");
    return mutate("/api/cart/items", { productId: product.id, mode: "increment", quantity: 1 }, { product, navigate });
  }, [mutate]);
  const retry = useCallback(async () => {
    if (busy.current) return;
    const problem = issueRef.current;
    if (problem?.intent) { await send(problem.intent); } else { await initialize(); }
  }, [initialize, send]);
  const check = useCallback(async () => {
    const intent = issueRef.current?.intent; if (!intent || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const data = await request<CartResponse>("/api/cart", { headers: { "Idempotency-Key": String(intent.payload.idempotencyKey), "X-Operation-Endpoint": intent.endpoint } });
      if (data.operation) { await success(data.operation.result, intent); }
      else setProblem({ kind: "uncertain", message: "Todavía no podemos confirmar el guardado. Comprueba el estado antes de hacer otro cambio.", intent });
    } catch (error) { if (error instanceof RequestFailure && error.status === 401) setProblem({ kind: "session", message: "No podemos acceder a tu sesión. Tus cambios quedan en pausa.", intent }); }
    finally { busy.current = false; setPending(false); }
  }, [setProblem, success]);
  const useCurrent = useCallback(() => {
    const details = issueRef.current?.details;
    if (details?.current) applyCart(details.current);
    if (details && "latestOrder" in details) setLatestOrder(details.latestOrder || null);
    setResetEpoch(epoch => epoch + 1); setProblem(null); setNotice("Se muestran los valores actuales.");
  }, [applyCart, setProblem]);
  const reapply = useCallback(async (quantity?: number) => {
    const problem = issueRef.current, current = problem?.details?.current;
    if (!current || !problem?.intent || busy.current) return;
    if (current.status !== "open") { setProblem({ ...problem, message: "Tu pedido cambió en otra vista. Este pedido ya está cerrado; usa los valores actuales para empezar uno nuevo." }); return; }
    applyCart(current);
    const intent = { ...problem.intent, payload: Object.freeze({ ...problem.intent.payload, ...(quantity !== undefined && problem.intent.payload.mode === "set" ? { quantity } : {}), cartId: current.id, expectedVersion: current.version, idempotencyKey: crypto.randomUUID() }) };
    await send(intent);
  }, [applyCart, send, setProblem]);
  return <Context.Provider value={{ menu, menuLoading, menuError, loadMenu, cart, latestOrder, loading, pending, issue, notice, resetEpoch, initialize, refresh, mutate, add, retry, check, useCurrent, reapply, clearIssue: () => setProblem(null) }}>{children}</Context.Provider>;
}
