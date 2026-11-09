import type { NextRequest } from "next/server";
import { respond } from "@/lib/server/http";
import { getOrders, mutate } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return respond(() => getOrders(request));
}
export async function POST(request: NextRequest) {
  return respond(() => mutate(request, "/api/orders"));
}
