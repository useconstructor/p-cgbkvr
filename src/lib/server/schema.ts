import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Transaction } from "@libsql/client";
import { getDatabase } from "@/lib/db";
import type { Resource } from "./model";

// Explicitly requested fictional demo records; prices are integer MXN centavos.
const seedProducts = [
  ["taco-al-pastor", "tacos", "Taco al pastor", "Láminas de pastor y piña.", 2800],
  ["taco-de-asada", "tacos", "Taco de asada", "Dados de asada y cebolla.", 3500],
  ["taco-de-pollo", "tacos", "Taco de pollo", "Tiras de pollo sobre tortilla.", 3000],
  ["taco-de-carnitas", "tacos", "Taco de carnitas", "Hebras de carnitas sobre tortilla.", 3200],
  ["taco-de-champinones", "tacos", "Taco de champiñones", "Láminas de champiñones sobre tortilla.", 2900],
  ["taco-de-nopales", "tacos", "Taco de nopales", "Tiras de nopales sobre tortilla.", 2700],
  ["agua-de-jamaica", "bebidas", "Agua de jamaica", "Bebida de jamaica ilustrada en rosa.", 2500],
  ["agua-de-horchata", "bebidas", "Agua de horchata", "Bebida blanca con una nota de canela.", 2800],
  ["agua-natural", "bebidas", "Agua natural", "Agua en un vaso transparente ilustrado.", 2000],
] as const;

const marker = "taqueria-monterey-menu-v1";
const statements = [
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL, description TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK(typeof(price_cents) = 'integer' AND price_cents >= 0),
    resource_json TEXT NOT NULL CHECK(json_valid(resource_json)),
    sort_order INTEGER NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
    current_cart_id TEXT REFERENCES carts(id) DEFERRABLE INITIALLY DEFERRED,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
    version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(version) = 'integer' AND version >= 0),
    status TEXT NOT NULL CHECK(status IN ('open', 'confirmed', 'replaced')),
    order_id TEXT UNIQUE REFERENCES orders(id) DEFERRABLE INITIALLY DEFERRED,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cart_lines (
    cart_id TEXT NOT NULL REFERENCES carts(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 20),
    PRIMARY KEY(cart_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
    cart_id TEXT NOT NULL UNIQUE REFERENCES carts(id),
    cart_version INTEGER NOT NULL CHECK(typeof(cart_version) = 'integer' AND cart_version >= 0),
    total_cents INTEGER NOT NULL CHECK(typeof(total_cents) = 'integer' AND total_cents >= 0),
    created_at TEXT NOT NULL, presentation_version INTEGER NOT NULL CHECK(presentation_version = 1)
  )`,
  `CREATE TABLE IF NOT EXISTS order_lines (
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents) = 'integer' AND unit_price_cents >= 0),
    quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 20),
    subtotal_cents INTEGER NOT NULL CHECK(typeof(subtotal_cents) = 'integer' AND subtotal_cents = unit_price_cents * quantity),
    resource_json TEXT NOT NULL CHECK(json_valid(resource_json)),
    sort_order INTEGER NOT NULL,
    PRIMARY KEY(order_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_operations (
    session_id TEXT NOT NULL REFERENCES sessions(id), endpoint TEXT NOT NULL,
    key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at TEXT NOT NULL,
    PRIMARY KEY(session_id, endpoint, key)
  )`,
  `CREATE TABLE IF NOT EXISTS session_initializations (
    key_hash TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id), created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS seed_markers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS orders_owner_created ON orders(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS carts_owner ON carts(session_id)`,
  `CREATE INDEX IF NOT EXISTS operations_owner_created ON idempotency_operations(session_id, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS preserve_orders_update BEFORE UPDATE ON orders
    BEGIN SELECT RAISE(ABORT, 'Immutable saved order'); END`,
  `CREATE TRIGGER IF NOT EXISTS preserve_orders_delete BEFORE DELETE ON orders
    BEGIN SELECT RAISE(ABORT, 'Immutable saved order'); END`,
  `CREATE TRIGGER IF NOT EXISTS preserve_order_lines_update BEFORE UPDATE ON order_lines
    BEGIN SELECT RAISE(ABORT, 'Immutable saved order line'); END`,
  `CREATE TRIGGER IF NOT EXISTS preserve_order_lines_delete BEFORE DELETE ON order_lines
    BEGIN SELECT RAISE(ABORT, 'Immutable saved order line'); END`,
];

async function verifiedResources(): Promise<Map<string, Resource>> {
  const manifestBytes = await readFile(path.join(process.cwd(), "public/menu/manifest.json"));
  if (manifestBytes.length > 64 * 1024) throw new Error("Invalid resource manifest");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.resources) ||
      manifest.resources.length !== seedProducts.length) throw new Error("Invalid resource manifest");
  const resources = new Map<string, Resource>();
  for (const [id] of seedProducts) {
    const matches = manifest.resources.filter((r: Resource) => r?.id === id);
    if (matches.length !== 1) throw new Error("Missing canonical resource");
    const r = matches[0] as Resource;
    if (r.version !== 1 || r.presentationVersion !== 1 || r.path !== `/menu/${id}-v1.svg` ||
        !/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error("Invalid canonical resource");
    const bytes = await readFile(path.join(process.cwd(), "public", r.path));
    if (bytes.length > 1024 * 1024 || !bytes.toString("utf8").includes("<svg") ||
        createHash("sha256").update(bytes).digest("hex") !== r.sha256) {
      throw new Error("Resource integrity failure");
    }
    resources.set(id, {
      id, version: 1, presentationVersion: 1, path: r.path, sha256: r.sha256,
    });
  }
  return resources;
}

/** BEGIN IMMEDIATE serializes writers across processes, not just one Node instance. */
export async function transaction<T>(
  mode: "read" | "write",
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let tx: Transaction | undefined;
    try {
      tx = await getDatabase().transaction(mode);
      const result = await work(tx);
      await tx.commit();
      return result;
    } catch (error) {
      if (tx && !tx.closed) await tx.rollback().catch(() => {});
      const code = (error as { code?: string })?.code ?? "";
      if (attempt >= 3 || !/^SQLITE_(BUSY|LOCKED)(_|$)/.test(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt + Math.random() * 30));
    } finally {
      tx?.close();
    }
  }
}

let ready: Promise<void> | undefined;
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = initialize().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

async function initialize(): Promise<void> {
  // Foreign keys are enabled on libSQL's connections. Check, never silently disable.
  const foreignKeys = await getDatabase().execute("PRAGMA foreign_keys");
  if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1) throw new Error("Foreign keys unavailable");
  const existing = await getDatabase().execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'seed_markers'",
  );
  if (existing.rows.length) {
    const seeded = await getDatabase().execute({
      sql: "SELECT id FROM seed_markers WHERE id = ?", args: [marker],
    });
    if (seeded.rows.length) return;
  }
  // No writes occur until every visual-authored canonical byte is available.
  const resources = await verifiedResources();
  await transaction("write", async (tx) => {
    await tx.batch(statements);
    const seeded = await tx.execute({ sql: "SELECT id FROM seed_markers WHERE id = ?", args: [marker] });
    if (seeded.rows.length) return;
    await tx.execute({
      sql: "INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?), (?, ?, ?)",
      args: ["tacos", "Tacos", 0, "bebidas", "Bebidas", 1],
    });
    for (const [index, [id, category, name, description, cents]] of seedProducts.entries()) {
      await tx.execute({
        sql: `INSERT INTO products (id, category_id, name, description, price_cents, resource_json, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, category, name, description, cents, JSON.stringify(resources.get(id)), index],
      });
    }
    await tx.execute({
      sql: "INSERT INTO seed_markers (id, created_at) VALUES (?, ?)",
      args: [marker, new Date().toISOString()],
    });
  });
}
