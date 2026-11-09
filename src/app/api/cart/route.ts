import type { NextRequest } from "next/server";
import { respond } from "@/lib/server/http";
import { getCart } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return respond(() => getCart(request));
}
