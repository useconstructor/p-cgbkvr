import "server-only";
import { createHash } from "node:crypto";
import type { Row, Transaction } from "@libsql/client";
import { ApiError, notFound } from "./errors";
import type { Cart, Line, Operation, Order, Owner, Product, Resource } from "./model";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function resource(value: unknown): Resource {
  const parsed = JSON.parse(String(value)) as Resource;
  if (!parsed || typeof parsed.id !== "string" || !Number.isSafeInteger(parsed.version) ||
      parsed.version < 1 || !Number.isSafeInteger(parsed.presentationVersion) ||
      parsed.presentationVersion < 1 ||
      !/^\/menu\/[a-z0-9-]+-v[1-9][0-9]*\.svg$/.test(parsed.path) ||
      !/^[a-f0-9]{64}$/.test(parsed.sha256)) throw new Error("Invalid persisted resource");
  return {
    id: parsed.id, version: parsed.version, presentationVersion: parsed.presentationVersion,
    path: parsed.path, sha256: parsed.sha256,
  };
}

function product(row: Row): Product {
  const priceCents = Number(row.price_cents);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error("Invalid persisted price");
  return {
    id: String(row.id), categoryId: String(row.category_id), name: String(row.name),
    description: String(row.description), priceCents, currency: "MXN",
    resource: resource(row.resource_json),
  };
}

export async function menu(tx: Transaction) {
  const categories = await tx.execute("SELECT id, name FROM categories ORDER BY sort_order");
  const products = await tx.execute(
    "SELECT id, category_id, name, description, price_cents, resource_json FROM products ORDER BY sort_order",
  );
  if (categories.rows.length !== 2 || products.rows.length !== 9) throw new Error("Catalog incomplete");
  return {
    catalogVersion: 1 as const,
    categories: categories.rows.map((r) => ({ id: String(r.id), name: String(r.name) })),
    products: products.rows.map(product),
  };
}

export async function findOwner(tx: Transaction, token: string | null): Promise<Owner | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await tx.execute({
    sql: "SELECT id, current_cart_id FROM sessions WHERE token_hash = ?", args: [hash(token)],
  });
  const row = result.rows[0];
  return row?.current_cart_id ? { id: String(row.id), currentCartId: String(row.current_cart_id) } : null;
}

export async function requireOwner(tx: Transaction, token: string | null): Promise<Owner> {
  const owner = await findOwner(tx, token);
  if (!owner) throw new ApiError(401, "SESSION_REQUIRED", "Necesitas recuperar tu sesión para continuar.");
  return owner;
}

function totals(lines: Line[]) {
  const totalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || totalUnits > 180 ||
      lines.length > 9 || lines.some((line) => !Number.isInteger(line.quantity) ||
        line.quantity < 1 || line.quantity > 20 ||
        !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0 ||
        line.subtotalCents !== line.unitPriceCents * line.quantity)) {
    throw new Error("Invalid persisted amounts");
  }
  return { totalCents, totalUnits };
}

export async function orderById(tx: Transaction, owner: Owner, id: string): Promise<Order> {
  const result = await tx.execute({
    sql: `SELECT id, cart_id, cart_version, total_cents, created_at, presentation_version
      FROM orders WHERE id = ? AND session_id = ?`,
    args: [id, owner.id],
  });
  const row = result.rows[0];
  if (!row) notFound();
  const savedLines = await tx.execute({
    sql: `SELECT product_id, name, unit_price_cents, quantity, subtotal_cents, resource_json
      FROM order_lines WHERE order_id = ? ORDER BY sort_order`,
    args: [id],
  });
  const lines: Line[] = savedLines.rows.map((line) => ({
    productId: String(line.product_id), name: String(line.name),
    unitPriceCents: Number(line.unit_price_cents), quantity: Number(line.quantity),
    subtotalCents: Number(line.subtotal_cents), resource: resource(line.resource_json),
  }));
  const amounts = totals(lines);
  if (!lines.length || amounts.totalCents !== Number(row.total_cents) ||
      Number(row.presentation_version) !== 1) throw new Error("Invalid saved order");
  return {
    id: String(row.id), cartId: String(row.cart_id), cartVersion: Number(row.cart_version),
    createdAt: String(row.created_at), currency: "MXN", lines, ...amounts, presentationVersion: 1,
  };
}

export async function latestOrder(tx: Transaction, owner: Owner): Promise<Order | null> {
  const result = await tx.execute({
    sql: "SELECT id FROM orders WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    args: [owner.id],
  });
  return result.rows.length ? orderById(tx, owner, String(result.rows[0].id)) : null;
}

export async function orders(tx: Transaction, owner: Owner): Promise<Order[]> {
  const result = await tx.execute({
    sql: "SELECT id FROM orders WHERE session_id = ? ORDER BY created_at DESC, rowid DESC",
    args: [owner.id],
  });
  const list: Order[] = [];
  for (const row of result.rows) list.push(await orderById(tx, owner, String(row.id)));
  return list;
}

export async function cartById(tx: Transaction, owner: Owner, id: string): Promise<Cart> {
  const result = await tx.execute({
    sql: "SELECT id, version, status, order_id FROM carts WHERE id = ? AND session_id = ?",
    args: [id, owner.id],
  });
  const row = result.rows[0];
  if (!row) notFound();
  let lines: Line[];
  if (row.status === "confirmed") {
    if (!row.order_id) throw new Error("Confirmed cart has no order");
    lines = (await orderById(tx, owner, String(row.order_id))).lines;
  } else {
    const currentLines = await tx.execute({
      sql: `SELECT p.id, p.name, p.price_cents, p.resource_json, l.quantity
        FROM cart_lines l JOIN products p ON p.id = l.product_id
        WHERE l.cart_id = ? ORDER BY p.sort_order`,
      args: [id],
    });
    lines = currentLines.rows.map((line) => ({
      productId: String(line.id), name: String(line.name),
      unitPriceCents: Number(line.price_cents), quantity: Number(line.quantity),
      subtotalCents: Number(line.price_cents) * Number(line.quantity),
      resource: resource(line.resource_json),
    }));
  }
  return {
    id: String(row.id), version: Number(row.version), status: row.status as Cart["status"],
    currency: "MXN", lines, ...totals(lines), orderId: row.order_id ? String(row.order_id) : null,
  };
}

export async function context(tx: Transaction, owner: Owner) {
  return {
    current: await cartById(tx, owner, owner.currentCartId),
    latestOrder: await latestOrder(tx, owner),
  };
}

export function operation(row: Row | undefined): Operation | null {
  return row ? {
    endpoint: String(row.endpoint),
    idempotencyKey: String(row.key),
    result: JSON.parse(String(row.response_json)),
  } : null;
}

export async function cartState(
  tx: Transaction, owner: Owner, endpoint?: string | null, key?: string | null,
) {
  const state = await context(tx, owner);
  const last = await tx.execute({
    sql: `SELECT endpoint, key, response_json FROM idempotency_operations
      WHERE session_id = ? ORDER BY rowid DESC LIMIT 1`,
    args: [owner.id],
  });
  const requested = endpoint && key ? await tx.execute({
    sql: `SELECT endpoint, key, response_json FROM idempotency_operations
      WHERE session_id = ? AND endpoint = ? AND key = ?`,
    args: [owner.id, endpoint, key],
  }) : null;
  return {
    cart: state.current, latestOrder: state.latestOrder,
    lastOperation: operation(last.rows[0]), operation: operation(requested?.rows[0]),
  };
}
