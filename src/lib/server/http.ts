import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, validation } from "./errors";

export type Body = Record<string, unknown>;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const cookieName = "tm_session";
export function token(request: NextRequest): string | null {
  // Reject ambiguous duplicate cookies rather than picking another partition's owner.
  const occurrences = (request.headers.get("cookie") ?? "").split(";")
    .filter((part) => part.trim().startsWith(`${cookieName}=`));
  if (occurrences.length !== 1) return null;
  const values = request.cookies.getAll(cookieName);
  return values.length === 1 ? values[0].value : null;
}

function configuredOrigins(): Set<string> {
  const values = [
    process.env.APP_ORIGIN,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];
  const result = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
          url.pathname === "/" && !url.search && !url.hash) result.add(url.origin);
    } catch { /* Invalid trusted configuration grants no origin. */ }
  }
  return result;
}

export function requireOrigin(request: NextRequest): string {
  const origin = request.headers.get("origin");
  if (!origin || !configuredOrigins().has(origin)) {
    throw new ApiError(403, "ORIGIN_FORBIDDEN", "No se permite guardar desde este origen.");
  }
  return origin;
}

export async function body(request: NextRequest): Promise<Body> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    validation({ body: "Envía un objeto JSON válido" });
  }
  if (Number(request.headers.get("content-length")) > 16384) {
    validation({ body: "La solicitud es demasiado grande" });
  }
  const reader = request.body?.getReader();
  if (!reader) validation({ body: "Envía un objeto JSON válido" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        validation({ body: "La solicitud es demasiado grande" });
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    validation({ body: "Envía un objeto JSON válido" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    validation({ body: "Envía un objeto JSON válido" });
  }
  return parsed as Body;
}

export function exactKeys(value: Body, allowed: readonly string[]) {
  const errors: Record<string, string> = Object.create(null);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors[key] = "Campo no permitido";
  }
  if (Object.keys(errors).length) validation(errors);
}

export function json(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function respond(work: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) {
      return json({
        error: {
          code: error.code, message: error.message,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        },
        ...error.context,
      }, error.status);
    }
    // No SQL, request fields, hashes, tokens, stacks or credential-bearing cause strings.
    return json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "No podemos consultar el pedido ahora. Conserva tus cambios e inténtalo de nuevo.",
      },
    }, 503);
  }
}

export function setSession(response: NextResponse, value: string, origin: string) {
  const secure = new URL(origin).protocol === "https:";
  response.cookies.set({
    name: cookieName, value, httpOnly: true, secure,
    sameSite: secure ? "none" : "lax", partitioned: secure, path: "/",
    // Cookie persistence is authorized; retained server records have no deletion policy.
    maxAge: 60 * 60 * 24 * 365,
  });
}
