import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything queries can run on: the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

/**
 * Connects with the server's direct Postgres connection (DATABASE_URL). This connection
 * bypasses RLS, so server code must check permissions itself (through packages/core), or
 * run the query as the user with `asUser`.
 */
export function createDatabase(
  url: string,
  options: { maxConnections?: number } = {},
): DatabaseHandle {
  // numeric is returned as string by default: exactly what we want (never JS numbers).
  const client = postgres(url, { max: options.maxConnections ?? 10, onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

/**
 * Runs queries as a signed-in user, so RLS applies exactly as it would for a request from
 * the browser with that user's JWT.
 */
export async function asUser<T>(
  db: Database,
  userId: string,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return run(tx);
  });
}
