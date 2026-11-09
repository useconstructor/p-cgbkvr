import "server-only";
import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

/** Lazy creation lets missing runtime credentials become a recoverable API error. */
export function getDatabase(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("Database configuration unavailable");
    client = createClient({ url, authToken, intMode: "number" });
  }
  return client;
}

// Preserve the scaffold helper's export without eagerly reading runtime secrets.
export const db = new Proxy({} as Client, {
  get(_target, property) {
    const instance = getDatabase();
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
