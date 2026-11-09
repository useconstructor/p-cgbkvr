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
type SessionIntent = { bootstrapKey: string; recover: boolean };
type SessionMarker = { expected?: boolean; bootstrapKey?: string; recover?: boolean };
const sessionStates = new Map<string, { expected?: boolean; intent?: SessionIntent }>();
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
export function establishSession(recover = false, retryOriginal = false): Promise<CartResponse> {
  if (initialization) return initialization;
  initialization = (async () => {
    const scope = contextKey();
    const state = sessionStates.get(scope) || {};
    sessionStates.set(scope, state);
    const accessFailure = () => sessionFailure("No podemos acceder a tu sesión. Permite las cookies y el almacenamiento para guardar tu pedido.");
    const establish = async () => {
      const markerKey = `tm-session-expectation:${scope}`;
      let marker: SessionMarker = {}, legacy: string | null = null;
      try {
        marker = JSON.parse(localStorage.getItem(markerKey) || "{}") || {};
        legacy = localStorage.getItem("tm-session-established") || localStorage.getItem("tm-session-expectation") || localStorage.getItem("tm-session");
      } catch { if (!recover) accessFailure(); }
      // Retain the entire submitted intent, even if storage becomes unavailable.
      if (!state.expected && !state.intent && marker.bootstrapKey && typeof marker.recover === "boolean") {
        state.intent = { bootstrapKey: marker.bootstrapKey, recover: marker.recover };
      }
      const remember = () => {
        state.expected = true;
        state.intent = undefined;
        try { localStorage.setItem(markerKey, JSON.stringify({ expected: true })); } catch { /* The private read, not storage, proves ownership. */ }
      };
      try {
        const current = await request<CartResponse>("/api/cart");
        remember();
        return current;
      } catch (error) {
        if (!(error instanceof RequestFailure) || error.status !== 401) throw error;
      }
      if (!recover && (state.expected || marker.expected || (state.intent && !retryOriginal) || legacy || scope === "embedded:unknown")) sessionFailure("No podemos acceder a tu sesión anterior. Los cambios quedan en pausa. Revisa si las cookies están permitidas o inicia una nueva sesión de forma explícita.");
      // The only persisted application data is nonsecret session expectation/bootstrap metadata.
      const intent = state.intent || { bootstrapKey: crypto.randomUUID(), recover };
      try { localStorage.setItem(markerKey, JSON.stringify({ ...marker, ...intent })); } catch { if (!recover) accessFailure(); }
      state.intent = intent;
      try {
        await post<SessionResponse>("/api/session", { idempotencyKey: intent.bootstrapKey, recover: intent.recover });
      } catch (error) {
        // A POST 401 does not establish ownership. Clear the refused intent
        // and keep expectation metadata to block ordinary replacement. Only
        // later explicit recovery may create another intent; storage is not proof.
        if (error instanceof RequestFailure) { if (error.status === 401) remember(); throw error; }
        // A lost response does not establish ownership. Read privately first;
        // only an explicit user retry may resubmit the frozen original intent.
        try {
          const current = await request<CartResponse>("/api/cart");
          remember();
          return current;
        } catch (readError) {
          if (!(readError instanceof RequestFailure) || readError.status !== 401) throw readError;
          throw new RequestFailure(0, { error: { code: "SESSION_INITIALIZATION_UNCERTAIN", message: "No podemos confirmar si se inició tu sesión. Reintenta el acceso para comprobarla; conservamos la misma solicitud." } });
        }
      }
      try {
        const verified = await request<CartResponse>("/api/cart");
        remember();
        return verified;
      } catch (error) {
        if (error instanceof RequestFailure && error.status === 401) accessFailure();
        throw error;
      }
    };
    let enteredLock = false;
    try {
      if (!navigator.locks?.request) return accessFailure();
      return await navigator.locks.request(`taqueria-session:${scope}`, { mode: "exclusive" }, () => {
        enteredLock = true;
        return establish();
      });
    } catch (error) {
      // Only a denied lock capability permits this fallback, never a failed request.
      if (!enteredLock && error instanceof DOMException && error.name === "SecurityError") {
        if (recover) return establish();
        return accessFailure();
      }
      throw error;
    }
  })().finally(() => { initialization = null; });
  return initialization;
}
