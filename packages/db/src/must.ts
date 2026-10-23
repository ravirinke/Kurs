/**
 * For values the code guarantees are present (e.g. an index into an array built from the
 * same list). Throws a clear error instead of continuing with undefined if that ever breaks.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}`);
  return value;
}
