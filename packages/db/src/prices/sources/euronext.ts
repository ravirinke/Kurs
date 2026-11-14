import { type HttpGet, httpGet } from "./http";
import { type ListedInstrument, MarketDataError } from "./types";

/*
 * Euronext's public instrument list (Oslo Børs is part of Euronext): the CSV behind the
 * "Download" button on live.euronext.com. Used only to know which shares exist; prices come
 * from elsewhere.
 */

const URL = "https://live.euronext.com/en/pd_es/data/stocks/download?mics=XOSL";
const BODY =
  "args%5Bfe_type%5D=csv&args%5Bfe_decimal_separator%5D=.&args%5Bfe_date_format%5D=d%2Fm%2FY";
const OSLO_MARKET = "Oslo Børs";
const TICKER = /^[A-Z0-9]{1,8}$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Splits one line of `;`-separated values, where a value may be wrapped in double quotes. */
function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ";" && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/** The shares on Oslo Børs' main list in NOK, from the CSV text. */
export function parseEuronextList(csv: string): ListedInstrument[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = splitLine(lines[0] ?? "");
  const column = (name: string) => header.indexOf(name);
  const [name, isin, symbol, market, currency] = [
    column("Name"),
    column("ISIN"),
    column("Symbol"),
    column("Market"),
    column("Currency"),
  ];
  if ([name, isin, symbol, market, currency].includes(-1))
    throw new MarketDataError("Euronext's list has changed format");

  const listed = new Map<string, ListedInstrument>();
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const ticker = cells[symbol] ?? "";
    const isinValue = cells[isin] ?? "";
    // Skips the three description lines after the header, other markets and other currencies.
    if (cells[market] !== OSLO_MARKET || cells[currency] !== "NOK") continue;
    if (!TICKER.test(ticker) || !ISIN.test(isinValue) || !cells[name]) continue;
    listed.set(ticker, { ticker, name: cells[name], isin: isinValue, currency: "NOK" });
  }
  return [...listed.values()];
}

export class EuronextSource {
  constructor(private readonly http: HttpGet = httpGet) {}

  async listOsloShares(): Promise<ListedInstrument[]> {
    const response = await this.http(URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: BODY,
    });
    if (response.status !== 200)
      throw new MarketDataError(`Euronext answered ${String(response.status)}`);
    return parseEuronextList(response.text);
  }
}
