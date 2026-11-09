import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import type { Transaction } from "@libsql/client";
import type { NextRequest } from "next/server";
import { ApiError, notFound, unavailable, validation } from "./errors";
import { body, cookieName, exactKeys, json, requireOrigin, setSession, token, uuid, type Body } from "./http";
import type { Cart, Endpoint, MutationResult, Owner } from "./model";
import { endpoints } from "./model";
import {
  cartById, cartState, context, findOwner, hash, latestOrder,
  menu, orderById, orders, requireOwner,
} from "./repository";
import { ensureSchema, transaction } from "./schema";

const envelopeKeys = ["cartId", "expectedVersion", "idempotencyKey"];
interface Envelope {
  cartId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

function envelope(value: Body): Envelope {
  const errors: Record<string, string> = Object.create(null);
  if (typeof value.cartId !== "string" || !uuid.test(value.cartId)) errors.cartId = "Carrito no válido";
  if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0) {
    errors.expectedVersion = "Versión no válida";
  }
  if (typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey)) {
    errors.idempotencyKey = "Clave de guardado no válida";
  }
  if (Object.keys(errors).length) validation(errors);
  return value as unknown as Envelope;
}

function payloadHash(value: Body): string {
  // Property order is irrelevant; scalar types and exact untrimmed values remain binding.
  return hash(JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]])));
}

async function conflict(
  tx: Transaction, owner: Owner, code: string, message: string, fieldErrors?: Record<string, string>,
): Promise<never> {
  throw new ApiError(409, code, message, fieldErrors, await context(tx, owner));
}

export async function getMenu() {
  await ensureSchema();
  const response = json(await transaction("read", menu));
  response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return response;
}

export async function getCart(request: NextRequest) {
  await ensureSchema();
  return json(await transaction("read", async (tx) => {
    const owner = await requireOwner(tx, token(request));
    const key = request.headers.get("idempotency-key");
    const endpoint = request.headers.get("x-operation-endpoint");
    if ((key !== null || endpoint !== null) && (!key || !uuid.test(key) || !endpoint || !endpoints.includes(endpoint))) {
      validation({ operation: "Indica la clave y la acción original de guardado" });
    }
    return cartState(tx, owner, endpoint, key);
  }));
}

export async function getOrders(request: NextRequest) {
  await ensureSchema();
  return json(await transaction("read", async (tx) => {
    const owner = await requireOwner(tx, token(request));
    return { orders: await orders(tx, owner) };
  }));
}

export async function getOrder(request: NextRequest, id: string) {
  await ensureSchema();
  return json(await transaction("read", async (tx) => {
    const owner = await requireOwner(tx, token(request));
    if (!uuid.test(id)) notFound();
    return { order: await orderById(tx, owner, id) };
  }));
}

export async function initializeSession(request: NextRequest) {
  const origin = requireOrigin(request);
  const value = await body(request);
  exactKeys(value, ["idempotencyKey", "recover"]);
  const errors: Record<string, string> = Object.create(null);
  if (typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey)) {
    errors.idempotencyKey = "Clave de guardado no válida";
  }
  if (typeof value.recover !== "boolean") errors.recover = "Indica si quieres recuperar la sesión";
  if (Object.keys(errors).length) validation(errors);
  await ensureSchema();
  const fingerprint = payloadHash(value);
  const keyHash = hash(`monterey/bootstrap/v1\n${origin}\n${value.idempotencyKey}`);
  const incomingToken = token(request);
  const result = await transaction("write", async (tx) => {
    const owner = await findOwner(tx, incomingToken);
    const previous = await tx.execute({
      sql: `SELECT i.payload_hash, i.session_id, s.token_hash, s.current_cart_id
        FROM session_initializations i JOIN sessions s ON s.id = i.session_id
        WHERE i.key_hash = ?`,
      args: [keyHash],
    });
    const initialization = previous.rows[0];
    if (owner) {
      // A valid cookie always wins over a bootstrap request; never rotate its owner.
      if (initialization?.session_id === owner.id && initialization.payload_hash !== fingerprint) {
        await conflict(tx, owner, "IDEMPOTENCY_CONFLICT", "Esta clave ya corresponde a otro guardado.");
      }
      return {
        response: {
          established: true, cart: await cartById(tx, owner, owner.currentCartId),
          latestOrder: await latestOrder(tx, owner),
        },
        cookie: null,
      };
    }
    if (request.cookies.has(cookieName) && value.recover !== true) {
      throw new ApiError(401, "SESSION_REQUIRED", "La sesión ya no está disponible. Recupera la sesión para continuar.");
    }
    if (initialization && initialization.payload_hash !== fingerprint) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Esta clave ya corresponde a otro guardado.");
    }
    const secret = process.env.TURSO_AUTH_TOKEN;
    if (!secret) unavailable();
    // A domain-separated cryptographic PRF produces an opaque 256-bit token. It
    // permits bootstrap replay after a lost response without storing token bytes.
    // Existing cookies are authorized ONLY by their stored SHA-256 hash.
    const sessionToken = createHmac("sha256", secret)
      .update(`monterey/session/v1\n${origin}\n${value.idempotencyKey}`)
      .digest("hex");
    let establishedOwner: Owner;
    if (initialization) {
      if (initialization.token_hash !== hash(sessionToken)) unavailable();
      establishedOwner = {
        id: String(initialization.session_id), currentCartId: String(initialization.current_cart_id),
      };
    } else {
      const id = randomUUID();
      const cartId = randomUUID();
      const now = new Date().toISOString();
      await tx.execute({
        sql: "INSERT INTO sessions (id, token_hash, current_cart_id, created_at) VALUES (?, ?, NULL, ?)",
        args: [id, hash(sessionToken), now],
      });
      await tx.execute({
        sql: `INSERT INTO carts (id, session_id, version, status, order_id, created_at)
          VALUES (?, ?, 0, 'open', NULL, ?)`,
        args: [cartId, id, now],
      });
      await tx.execute({
        sql: "UPDATE sessions SET current_cart_id = ? WHERE id = ?", args: [cartId, id],
      });
      await tx.execute({
        sql: `INSERT INTO session_initializations (key_hash, payload_hash, session_id, created_at)
          VALUES (?, ?, ?, ?)`,
        args: [keyHash, fingerprint, id, now],
      });
      establishedOwner = { id, currentCartId: cartId };
    }
    return {
      response: {
        established: true, cart: await cartById(tx, establishedOwner, establishedOwner.currentCartId),
        latestOrder: await latestOrder(tx, establishedOwner),
      },
      cookie: sessionToken,
    };
  });
  const response = json(result.response);
  if (result.cookie) setSession(response, result.cookie, origin);
  return response;
}

async function recordOperation(
  tx: Transaction, owner: Owner, endpoint: Endpoint, input: Envelope, fingerprint: string,
  result: MutationResult,
) {
  await tx.execute({
    sql: `INSERT INTO idempotency_operations
      (session_id, endpoint, key, payload_hash, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [owner.id, endpoint, input.idempotencyKey, fingerprint, JSON.stringify(result), new Date().toISOString()],
  });
  return result;
}

async function productExists(tx: Transaction, value: unknown): Promise<string> {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(value)) {
    validation({ productId: "Producto no válido" });
  }
  const found = await tx.execute({ sql: "SELECT id FROM products WHERE id = ?", args: [value] });
  if (!found.rows.length) validation({ productId: "Producto no válido" });
  return value;
}

async function updateItem(tx: Transaction, owner: Owner, cart: Cart, value: Body) {
  const productId = await productExists(tx, value.productId);
  if (value.mode !== "increment" && value.mode !== "set") {
    validation({ mode: "Indica cómo quieres cambiar la cantidad" });
  }
  if (value.mode === "increment" && value.quantity !== 1) {
    validation({ quantity: "Solo puedes añadir una unidad" });
  }
  if (!Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 20) {
    validation({ quantity: "Escribe un número entero del 1 al 20" });
  }
  const oldQuantity = cart.lines.find((line) => line.productId === productId)?.quantity ?? 0;
  const quantity = value.mode === "increment" ? oldQuantity + 1 : Number(value.quantity);
  if (quantity > 20) {
    await conflict(tx, owner, "QUANTITY_LIMIT",
      "Puedes elegir hasta 20 unidades de este producto. La cantidad sigue en 20.",
      { quantity: "Puedes elegir hasta 20 unidades de este producto. La cantidad sigue en 20." });
  }
  await tx.execute({
    sql: `INSERT INTO cart_lines (cart_id, product_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity`,
    args: [cart.id, productId, quantity],
  });
  await tx.execute({ sql: "UPDATE carts SET version = version + 1 WHERE id = ?", args: [cart.id] });
  return { cart: await cartById(tx, owner, cart.id), order: null };
}

async function removeItem(tx: Transaction, owner: Owner, cart: Cart, value: Body) {
  const productId = await productExists(tx, value.productId);
  if (!cart.lines.some((line) => line.productId === productId)) {
    await conflict(tx, owner, "LINE_MISSING", "Este producto ya no está en el pedido.");
  }
  await tx.execute({
    sql: "DELETE FROM cart_lines WHERE cart_id = ? AND product_id = ?", args: [cart.id, productId],
  });
  await tx.execute({ sql: "UPDATE carts SET version = version + 1 WHERE id = ?", args: [cart.id] });
  return { cart: await cartById(tx, owner, cart.id), order: null };
}

async function newCart(tx: Transaction, owner: Owner, cart: Cart, value: Body) {
  if (typeof value.replaceDraft !== "boolean") {
    validation({ replaceDraft: "Indica si quieres empezar otro pedido" });
  }
  if (cart.status === "open" && cart.lines.length && !value.replaceDraft) {
    await conflict(tx, owner, "DRAFT_REPLACE_REQUIRED", "Confirma si quieres empezar otro pedido.");
  }
  if (cart.status === "open") {
    await tx.execute({
      sql: "UPDATE carts SET status = 'replaced', version = version + 1 WHERE id = ?",
      args: [cart.id],
    });
  }
  const id = randomUUID();
  await tx.execute({
    sql: `INSERT INTO carts (id, session_id, version, status, order_id, created_at)
      VALUES (?, ?, 0, 'open', NULL, ?)`,
    args: [id, owner.id, new Date().toISOString()],
  });
  await tx.execute({ sql: "UPDATE sessions SET current_cart_id = ? WHERE id = ?", args: [id, owner.id] });
  return { cart: await cartById(tx, owner, id), order: null };
}

async function confirmOrder(tx: Transaction, owner: Owner, cart: Cart): Promise<MutationResult> {
  if (!cart.lines.length) validation({ cart: "Añade productos antes de confirmar" });
  const id = randomUUID();
  const now = new Date().toISOString();
  await tx.execute({
    sql: `INSERT INTO orders
      (id, session_id, cart_id, cart_version, total_cents, created_at, presentation_version)
      VALUES (?, ?, ?, ?, ?, ?, 1)`,
    args: [id, owner.id, cart.id, cart.version, cart.totalCents, now],
  });
  for (const [index, line] of cart.lines.entries()) {
    await tx.execute({
      sql: `INSERT INTO order_lines
        (order_id, product_id, name, unit_price_cents, quantity, subtotal_cents, resource_json, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, line.productId, line.name, line.unitPriceCents, line.quantity,
        line.subtotalCents, JSON.stringify(line.resource), index,
      ],
    });
  }
  await tx.execute({
    sql: "UPDATE carts SET status = 'confirmed', order_id = ?, version = version + 1 WHERE id = ?",
    args: [id, cart.id],
  });
  return { cart: await cartById(tx, owner, cart.id), order: await orderById(tx, owner, id) };
}

export async function mutate(request: NextRequest, endpoint: Endpoint) {
  requireOrigin(request);
  await ensureSchema();
  // Authenticate before body validation; a rejected anonymous caller learns no data.
  const cookie = token(request);
  await transaction("read", (tx) => requireOwner(tx, cookie));
  const value = await body(request);
  const extras = endpoint === "/api/cart/items" ? ["productId", "mode", "quantity"]
    : endpoint === "/api/cart/remove" ? ["productId"]
      : endpoint === "/api/cart/new" ? ["replaceDraft"] : [];
  if (typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey)) {
    validation({ idempotencyKey: "Clave de guardado no válida" });
  }
  const idempotencyKey = value.idempotencyKey;
  const fingerprint = payloadHash(value);
  return json(await transaction("write", async (tx) => {
    const owner = await requireOwner(tx, cookie);
    const previous = await tx.execute({
      sql: `SELECT payload_hash, response_json FROM idempotency_operations
        WHERE session_id = ? AND endpoint = ? AND key = ?`,
      args: [owner.id, endpoint, idempotencyKey],
    });
    if (previous.rows.length) {
      if (previous.rows[0].payload_hash !== fingerprint) {
        await conflict(tx, owner, "IDEMPOTENCY_CONFLICT", "Esta clave ya corresponde a otro guardado.");
      }
      return JSON.parse(String(previous.rows[0].response_json)) as MutationResult;
    }
    exactKeys(value, [...envelopeKeys, ...extras]);
    const input = envelope(value);
    const cart = await cartById(tx, owner, input.cartId);
    // Separate keys confirming the same already saved cart converge on that order,
    // including after an explicit new cart; no business records are duplicated.
    if (endpoint === "/api/orders" && cart.status === "confirmed" && cart.orderId) {
      return recordOperation(tx, owner, endpoint, input, fingerprint, {
        cart, order: await orderById(tx, owner, cart.orderId),
      });
    }
    if (owner.currentCartId !== cart.id) {
      await conflict(tx, owner, "VERSION_CONFLICT", "Tu pedido cambió en otra vista.");
    }
    if (endpoint !== "/api/cart/new" && cart.status !== "open") {
      await conflict(tx, owner, "CART_CLOSED", "Este pedido está guardado. Empieza otro pedido para añadir productos.");
    }
    if (cart.version !== input.expectedVersion) {
      await conflict(tx, owner, "VERSION_CONFLICT", "Tu pedido cambió en otra vista.");
    }
    let result: MutationResult;
    switch (endpoint) {
      case "/api/cart/items": result = await updateItem(tx, owner, cart, value); break;
      case "/api/cart/remove": result = await removeItem(tx, owner, cart, value); break;
      case "/api/cart/new": result = await newCart(tx, owner, cart, value); break;
      case "/api/orders": result = await confirmOrder(tx, owner, cart); break;
    }
    return recordOperation(tx, owner, endpoint, input, fingerprint, result);
  }));
}
