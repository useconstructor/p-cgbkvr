import "server-only";
import type { Cart, Order } from "./model";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
    readonly context?: { current: Cart; latestOrder: Order | null },
  ) {
    super(message);
  }
}

export function validation(fieldErrors: Record<string, string>): never {
  throw new ApiError(400, "VALIDATION_ERROR", "Revisa los campos indicados.", fieldErrors);
}

export function unavailable(): never {
  throw new ApiError(
    503,
    "SERVICE_UNAVAILABLE",
    "No podemos consultar el pedido ahora. Conserva tus cambios e inténtalo de nuevo.",
  );
}

export function notFound(): never {
  throw new ApiError(404, "NOT_FOUND", "No encontramos ese registro.");
}
