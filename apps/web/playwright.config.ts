import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real app, local Supabase and Mailpit.
 * Needs `pnpm db:start` and `pnpm db:reset` first. Starts `next dev` unless it is running.
 * Times are set with the dev time machine, so the result does not depend on when it runs.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/logg-inn",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
