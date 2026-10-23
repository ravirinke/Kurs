import { decimal, type Decimal } from "@aksjeliga/core";

/**
 * Reads a number the way Norwegians type it: "100 000", "100000,50", "1.5". Returns null
 * for anything that is not a plain decimal number. Never goes through a JS number.
 */
export function parseDecimalInput(input: string | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null;
  const cleaned = input
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(",", ".")
    .replace("−", "-");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return decimal(cleaned);
}

/** A form field as a string ("" when missing). */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
