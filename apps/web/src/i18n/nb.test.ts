import { describe, expect, it } from "vitest";

import { nb } from "./nb";

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(collectStrings);
  return [];
}

describe("nb messages", () => {
  it("has an app name", () => {
    expect(nb.app.name.length).toBeGreaterThan(0);
  });

  it("has no empty strings", () => {
    for (const text of collectStrings(nb)) expect(text.trim()).not.toBe("");
  });
});
