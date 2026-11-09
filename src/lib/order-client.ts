import type { ApiError, CartResponse, SessionResponse } from "./order-types";

export class RequestFailure extends Error {
  constructor(public status: number, public body: ApiError) { super(body.error.message); }
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
    const body = await response.json();
    if (!response.ok) throw new RequestFailure(response.status, body?.error ? body : { error: { code: "SERVICE_UNAVAILABLE", message: "No pudimos completar la solicitud. Reintenta." } });
    return body as T;
  } finally { window.clearTimeout(timeout); }
}
export const post = <T,>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
export const validQuantity = (raw: string) => /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= 1 && Number(raw) <= 20;

let initialization: Promise<CartResponse> | null = null;
function contextKey() {
  if (window.self === window.top) return "direct";
  const origins = window.location.ancestorOrigins;
  if (origins?.length) return `embedded:${origins[origins.length - 1]}`;
  try { return `embedded:${window.top!.location.origin}`; } catch { /* Cross-origin access is intentionally denied. */ }
  return "embedded:unknown";
}
function sessionFailure(message: string): never {
  throw new RequestFailure(401, { error: { code: "SESSION_REQUIRED", message } });
}
export function establishSession(recover = false): Promise<CartResponse> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!navigator.locks?.request) sessionFailure("No podemos proteger tu sesión en este navegador. Abre la página en un navegador con conexiones seguras y vuelve a intentarlo.");
    const scope = contextKey();
    return navigator.locks.request(`taqueria-session:${scope}`, { mode: "exclusive" }, async () => {
      const markerKey = `tm-session-expectation:${scope}`;
      let marker: { expected?: boolean; bootstrapKey?: string; recover?: boolean } = {};
      try { marker = JSON.parse(localStorage.getItem(markerKey) || "{}"); } catch { sessionFailure("No podemos acceder a tu sesión. Permite las cookies y el almacenamiento para guardar tu pedido."); }
      try {
        const current = await request<CartResponse>("/api/cart");
        localStorage.setItem(markerKey, JSON.stringify({ expected: true }));
        return current;
      } catch (error) {
        if (!(error instanceof RequestFailure) || error.status !== 401) throw error;
      }
      const legacy = localStorage.getItem("tm-session-established") || localStorage.getItem("tm-session-expectation") || localStorage.getItem("tm-session");
      if (!recover && (marker.expected || legacy || scope === "embedded:unknown")) sessionFailure("No podemos acceder a tu sesión anterior. Los cambios quedan en pausa. Revisa si las cookies están permitidas o inicia una nueva sesión de forma explícita.");
      // The only persisted application data is nonsecret session expectation/bootstrap metadata.
      const bootstrapKey = marker.bootstrapKey && marker.recover === recover ? marker.bootstrapKey : crypto.randomUUID();
      localStorage.setItem(markerKey, JSON.stringify({ ...marker, bootstrapKey, recover }));
      await post<SessionResponse>("/api/session", { idempotencyKey: bootstrapKey, recover });
      const verified = await request<CartResponse>("/api/cart");
      localStorage.setItem(markerKey, JSON.stringify({ expected: true }));
      return verified;
    });
  })().finally(() => { initialization = null; });
  return initialization;
}
