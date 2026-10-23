import { describe, expect, it } from "vitest";

import { parseDecimalInput } from "./parse";

describe("parseDecimalInput", () => {
  it.each([
    ["100 000", "100000"],
    ["100\u00A0000,50", "100000.5"],
    ["1.5", "1.5"],
    ["0,05", "0.05"],
    [" 42 ", "42"],
  ])("reads %j as %s", (input, expected) => {
    expect(parseDecimalInput(input)?.toString()).toBe(expected);
  });

  it.each([[""], ["abc"], ["1,2,3"], ["1e5"], ["12kr"]])("rejects %j", (input) => {
    expect(parseDecimalInput(input)).toBeNull();
  });
});
