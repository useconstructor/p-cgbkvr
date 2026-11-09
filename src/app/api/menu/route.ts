import { respond } from "@/lib/server/http";
import { getMenu } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return respond(getMenu);
}
