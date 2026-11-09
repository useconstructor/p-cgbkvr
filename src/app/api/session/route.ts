import type { NextRequest } from "next/server";
import { respond } from "@/lib/server/http";
import { initializeSession } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  return respond(() => initializeSession(request));
}
