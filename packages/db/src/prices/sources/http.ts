import { decimal, type Decimal } from "@aksjeliga/core";

import { MarketDataError } from "./types";

/** The part of `fetch` the sources use, so tests can answer with stored responses. */
export type HttpGet = (
  url: string,
  init?: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text: string }>;

const TIMEOUT_MS = 10_000;
/** A generic client name: no contact details or project names go to the sources. */
const USER_AGENT = "Mozilla/5.0 (compatible; price-cache)";

/** `fetch` with a timeout. Network failures become MarketDataError. */
export const httpGet: HttpGet = async (url, init = {}) => {
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...init.headers },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    throw new MarketDataError(
      `Request to ${new URL(url).host} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** JSON with every number kept as its source text ("407.6"), so no price passes through a float. */
export type JsonValue = string | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

/**
 * Parses JSON without turning numbers into JS numbers: each numeric literal is returned as
 * the exact text the source sent (JSON.parse source text access, Node 22+).
 */
export function parseJson(text: string, origin: string): JsonValue {
  const keepNumbers: Reviver = (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (context?.source === undefined)
      throw new MarketDataError("This runtime cannot parse JSON numbers exactly");
    return context.source;
  };
  try {
    return JSON.parse(text, keepNumbers as Parameters<typeof JSON.parse>[1]) as JsonValue;
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    throw new MarketDataError(`${origin} did not answer with JSON`);
  }
}

export function asObject(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

export function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** A positive decimal from a numeric literal, or null (sources send null for missing bars). */
export function asPositiveDecimal(value: JsonValue | undefined): Decimal | null {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return null;
  const parsed = decimal(value);
  return parsed.greaterThan(0) ? parsed : null;
}

/** Whole seconds since the epoch (a timestamp, not an amount), or null. */
export function asEpochSeconds(value: JsonValue | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

/** Runs tasks with at most `limit` in flight, so a big batch does not flood a source. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
