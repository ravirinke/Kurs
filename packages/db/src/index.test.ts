import { describe, expect, it } from "vitest";

import { DB_PACKAGE } from "./index";

describe("db package", () => {
  it("is wired up", () => {
    expect(DB_PACKAGE).toBe("@aksjeliga/db");
  });
});
