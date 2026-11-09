import type { NextRequest } from "next/server";
import { respond } from "@/lib/server/http";
import { getOrder } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return respond(async () => getOrder(request, (await context.params).id));
}
