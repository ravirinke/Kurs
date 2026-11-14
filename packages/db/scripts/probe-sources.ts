/*
 * Manual probe of the market-data sources (phase 6, step 0). Not part of the tests.
 * Shows which endpoints answer with our keys, so we can decide which source serves what.
 *
 *   pnpm --filter @aksjeliga/db exec tsx scripts/probe-sources.ts
 *
 * Needs FINNHUB_API_KEY in the root .env for the Finnhub part. Never prints the key.
 */
import { loadRootEnv } from "../src/env";

loadRootEnv();

const TIMEOUT_MS = 15_000;
const PREVIEW_CHARS = 600;
const USER_AGENT = "Mozilla/5.0 (compatible; market-data-probe)";

interface ProbeResult {
  status: number | "error";
  body: string;
}

async function probe(url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: "error", body: error instanceof Error ? error.message : String(error) };
  }
}

function report(label: string, result: ProbeResult): void {
  const preview = result.body.replaceAll(/\s+/g, " ").slice(0, PREVIEW_CHARS);
  console.log(
    `\n### ${label}\nstatus: ${String(result.status)}, ${String(result.body.length)} chars`,
  );
  console.log(preview);
}

function unixSeconds(daysAgo: number): string {
  return String(Math.floor(Date.now() / 1000) - daysAgo * 86_400);
}

async function probeFinnhub(): Promise<void> {
  const key = process.env["FINNHUB_API_KEY"];
  if (!key) {
    console.log("\n## Finnhub: skipped, FINNHUB_API_KEY is not set in .env");
    return;
  }
  console.log("\n## Finnhub");
  const base = "https://finnhub.io/api/v1";
  const headers = { "X-Finnhub-Token": key };
  const from = unixSeconds(30);
  const to = unixSeconds(0);
  const paths: [string, string][] = [
    ["quote AAPL (Nasdaq)", "/quote?symbol=AAPL"],
    ["quote JPM (NYSE)", "/quote?symbol=JPM"],
    ["quote EQNR.OL (Oslo)", "/quote?symbol=EQNR.OL"],
    ["symbols US, XNAS", "/stock/symbol?exchange=US&mic=XNAS"],
    ["symbols US, XNYS", "/stock/symbol?exchange=US&mic=XNYS"],
    ["symbols OL", "/stock/symbol?exchange=OL"],
    ["candles AAPL daily", `/stock/candle?symbol=AAPL&resolution=D&from=${from}&to=${to}`],
    ["splits AAPL", "/stock/split?symbol=AAPL&from=2020-01-01&to=2026-12-31"],
    ["dividends AAPL", "/stock/dividend?symbol=AAPL&from=2025-01-01&to=2026-12-31"],
    ["dividends2 AAPL", "/stock/dividend2?symbol=AAPL"],
    ["forex rates USD", "/forex/rates?base=USD"],
    [
      "forex candles USD/NOK",
      `/forex/candle?symbol=OANDA:USD_NOK&resolution=D&from=${from}&to=${to}`,
    ],
  ];
  for (const [label, path] of paths) {
    const result = await probe(base + path, headers);
    report(label, result);
    if (label.startsWith("symbols") && result.status === 200) summariseSymbols(result.body);
  }
}

/** Counts per security type and how many rows carry a MIC and an ISIN. */
function summariseSymbols(body: string): void {
  try {
    const rows = JSON.parse(body) as { type?: string; mic?: string; isin?: string | null }[];
    const byType = new Map<string, number>();
    let withIsin = 0;
    let withMic = 0;
    for (const row of rows) {
      const type = row.type === undefined || row.type === "" ? "(none)" : row.type;
      byType.set(type, (byType.get(type) ?? 0) + 1);
      if (row.isin) withIsin += 1;
      if (row.mic) withMic += 1;
    }
    console.log(
      `rows: ${String(rows.length)}, with isin: ${String(withIsin)}, with mic: ${String(withMic)}`,
    );
    console.log([...byType].map(([type, count]) => `${type}: ${String(count)}`).join(", "));
  } catch {
    console.log("could not parse the symbol list");
  }
}

async function probeYahoo(): Promise<void> {
  console.log("\n## Yahoo");
  const base = "https://query1.finance.yahoo.com";
  const charts: [string, string][] = [
    ["chart EQNR.OL 5m 1d", "/v8/finance/chart/EQNR.OL?interval=5m&range=1d"],
    ["chart AAPL 5m 1d", "/v8/finance/chart/AAPL?interval=5m&range=1d"],
    ["chart USDNOK=X 5m 1d", "/v8/finance/chart/USDNOK=X?interval=5m&range=1d"],
    [
      "chart EQNR.OL 1d 2y events",
      "/v8/finance/chart/EQNR.OL?interval=1d&range=2y&events=div,split",
    ],
    ["chart AAPL 1d 10y events", "/v8/finance/chart/AAPL?interval=1d&range=10y&events=div,split"],
    ["spark batch", "/v7/finance/spark?symbols=EQNR.OL,DNB.OL,AAPL&range=1d&interval=5m"],
  ];
  for (const [label, path] of charts) {
    const result = await probe(base + path);
    report(label, result);
    if (label.startsWith("chart") && result.status === 200) summariseChart(result.body);
  }
}

/** The fields we care about: delay, currency, time of the last price, events. */
function summariseChart(body: string): void {
  try {
    const parsed = JSON.parse(body) as {
      chart: {
        result: {
          meta: Record<string, unknown>;
          timestamp?: number[];
          events?: { dividends?: Record<string, unknown>; splits?: Record<string, unknown> };
        }[];
      };
    };
    const result = parsed.chart.result[0];
    if (!result) return;
    const { meta, timestamp, events } = result;
    const marketTime =
      typeof meta["regularMarketTime"] === "number" ? meta["regularMarketTime"] : 0;
    const lastBar = timestamp?.at(-1) ?? 0;
    console.log(
      JSON.stringify({
        currency: meta["currency"],
        exchangeName: meta["exchangeName"],
        fullExchangeName: meta["fullExchangeName"],
        instrumentType: meta["instrumentType"],
        dataGranularity: meta["dataGranularity"],
        regularMarketPrice: meta["regularMarketPrice"],
        regularMarketTime: new Date(marketTime * 1000).toISOString(),
        ageOfPriceSeconds: Math.floor(Date.now() / 1000) - marketTime,
        bars: timestamp?.length ?? 0,
        lastBar: new Date(lastBar * 1000).toISOString(),
        now: new Date().toISOString(),
      }),
    );
    const dividends = Object.values(events?.dividends ?? {});
    const splits = Object.values(events?.splits ?? {});
    console.log(`dividends: ${String(dividends.length)}, splits: ${String(splits.length)}`);
    if (dividends.length > 0) console.log("last dividend:", JSON.stringify(dividends.at(-1)));
    if (splits.length > 0) console.log("last split:", JSON.stringify(splits.at(-1)));
  } catch {
    console.log("could not parse the chart");
  }
}

await probeFinnhub();
await probeYahoo();
