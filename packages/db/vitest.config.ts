import { defineConfig } from "vitest/config";

// Unit tests only (no database). Database tests: vitest.db.config.ts / `pnpm test:db`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: { TZ: "UTC" },
  },
});
