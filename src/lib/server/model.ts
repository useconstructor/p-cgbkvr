import "server-only";

export interface Resource {
  id: string;
  version: 1;
  presentationVersion: 1;
  path: string;
  sha256: string;
}
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: "MXN";
  resource: Resource;
}
export interface Line {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  resource: Resource;
}
export interface Cart {
  id: string;
  version: number;
  status: "open" | "confirmed" | "replaced";
  currency: "MXN";
  lines: Line[];
  totalCents: number;
  totalUnits: number;
  orderId: string | null;
}
export interface Order {
  id: string;
  cartId: string;
  cartVersion: number;
  createdAt: string;
  currency: "MXN";
  lines: Line[];
  totalCents: number;
  totalUnits: number;
  presentationVersion: 1;
}
export interface MutationResult {
  cart: Cart;
  order: Order | null;
}
export interface Operation {
  endpoint: string;
  idempotencyKey: string;
  result: MutationResult;
}
export interface Owner {
  id: string;
  currentCartId: string;
}
export type Endpoint = "/api/cart/items" | "/api/cart/remove" | "/api/cart/new" | "/api/orders";
export const endpoints: readonly string[] = [
  "/api/cart/items", "/api/cart/remove", "/api/cart/new", "/api/orders",
];
