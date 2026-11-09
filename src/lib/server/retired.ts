import "server-only";
import { json } from "./http";

/** Unrelated scaffold modules are not part of this two-page demo. */
export async function retired() {
  return json({ error: { code: "NOT_FOUND", message: "No encontramos ese registro." } }, 404);
}
