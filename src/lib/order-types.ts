export type Currency = "MXN";
export interface Category { id: string; name: string }
export interface Resource { id: string; version: 1; presentationVersion: 1; path: string; sha256: string }
export interface Product { id: string; categoryId: string; name: string; description: string; priceCents: number; currency: Currency; resource: Resource }
export interface Menu { catalogVersion: 1; categories: Category[]; products: Product[] }
export interface Line { productId: string; name: string; unitPriceCents: number; quantity: number; subtotalCents: number; resource: Resource }
export interface Cart { id: string; version: number; status: "open" | "confirmed" | "replaced"; currency: Currency; lines: Line[]; totalCents: number; totalUnits: number; orderId: string | null }
export interface Order { id: string; cartId: string; cartVersion: number; createdAt: string; currency: Currency; lines: Line[]; totalCents: number; totalUnits: number; presentationVersion: 1 }
export interface MutationResult { cart: Cart; order: Order | null }
export interface Operation { endpoint: string; idempotencyKey: string; result: MutationResult }
export interface CartResponse { cart: Cart; latestOrder: Order | null; lastOperation: Operation | null; operation: Operation | null }
export interface SessionResponse { established: true; cart: Cart; latestOrder: Order | null }
export interface MutationEnvelope { cartId: string; expectedVersion: number; idempotencyKey: string }
export interface ApiError { error: { code: string; message: string; fieldErrors?: Record<string, string> }; current?: Cart; latestOrder?: Order | null }
