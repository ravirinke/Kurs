import { defineConfig } from "vitest/config";

/**
 * Tests against the local Supabase database (`pnpm db:start` first). Each test creates its
 * own users and leagues, so they can run against a seeded database.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { TZ: "UTC" },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One file at a time keeps connection counts low and output readable.
    fileParallelism: false,
  },
});
