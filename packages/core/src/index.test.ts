import { describe, expect, it } from "vitest";

import { CORE_PACKAGE } from "./index";

describe("core package", () => {
  it("is wired up", () => {
    expect(CORE_PACKAGE).toBe("@aksjeliga/core");
  });
});
