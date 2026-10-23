import "server-only";

import { createDatabase, type Database } from "@aksjeliga/db";

import { serverEnv } from "./env";

// One connection pool per server process (survives hot reloads in development).
const globalForDb = globalThis as unknown as { aksjeligaDb?: Database };

export function getDb(): Database {
  globalForDb.aksjeligaDb ??= createDatabase(serverEnv.databaseUrl).db;
  return globalForDb.aksjeligaDb;
}
