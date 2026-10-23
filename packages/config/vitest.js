import { defineConfig } from "vitest/config";

/** Shared Vitest config. Packages spread this and add their own options if needed. */
export const vitestConfig = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Business logic must be deterministic: tests never depend on the wall clock or TZ of the machine.
    env: { TZ: "UTC" },
  },
});
