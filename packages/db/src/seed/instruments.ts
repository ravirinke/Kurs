import type { Currency } from "@aksjeliga/core";

export interface CatalogueInstrument {
  ticker: string;
  isin: string;
  name: string;
  exchangeId: string;
  currency: Currency;
  /** Typical price level for the mock provider (not real market data). */
  mockBasePrice: string;
}

/*
 * The instruments we seed. ⚠️ ISINs and tickers were entered manually and should be checked
 * against the exchanges before connecting a real price API. Base prices are rough levels for
 * the mock only.
 */
export const INSTRUMENT_CATALOGUE: readonly CatalogueInstrument[] = [
  // Oslo Børs (NOK)
  {
    ticker: "EQNR",
    isin: "NO0010096985",
    name: "Equinor",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "265.40",
  },
  {
    ticker: "DNB",
    isin: "NO0010161896",
    name: "DNB Bank",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "245.20",
  },
  {
    ticker: "NHY",
    isin: "NO0005052605",
    name: "Norsk Hydro",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "68.50",
  },
  {
    ticker: "TEL",
    isin: "NO0010063308",
    name: "Telenor",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "150.80",
  },
  {
    ticker: "ORK",
    isin: "NO0003733800",
    name: "Orkla",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "105.60",
  },
  {
    ticker: "MOWI",
    isin: "NO0003054108",
    name: "Mowi",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "201.00",
  },
  {
    ticker: "YAR",
    isin: "NO0010208051",
    name: "Yara International",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "362.00",
  },
  {
    ticker: "KOG",
    isin: "NO0003043309",
    name: "Kongsberg Gruppen",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "298.00",
  },
  {
    ticker: "AKRBP",
    isin: "NO0010345853",
    name: "Aker BP",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "252.40",
  },
  {
    ticker: "SALM",
    isin: "NO0010310956",
    name: "SalMar",
    exchangeId: "XOSL",
    currency: "NOK",
    mockBasePrice: "548.00",
  },

  // Nasdaq Stockholm (SEK)
  {
    ticker: "VOLV B",
    isin: "SE0000115446",
    name: "Volvo B",
    exchangeId: "XSTO",
    currency: "SEK",
    mockBasePrice: "268.00",
  },
  {
    ticker: "ERIC B",
    isin: "SE0000108656",
    name: "Ericsson B",
    exchangeId: "XSTO",
    currency: "SEK",
    mockBasePrice: "80.30",
  },
  {
    ticker: "ATCO A",
    isin: "SE0017486889",
    name: "Atlas Copco A",
    exchangeId: "XSTO",
    currency: "SEK",
    mockBasePrice: "165.50",
  },
  {
    ticker: "INVE B",
    isin: "SE0015811963",
    name: "Investor B",
    exchangeId: "XSTO",
    currency: "SEK",
    mockBasePrice: "290.10",
  },
  {
    ticker: "HM B",
    isin: "SE0000106270",
    name: "H&M B",
    exchangeId: "XSTO",
    currency: "SEK",
    mockBasePrice: "150.25",
  },
  {
    ticker: "SEB A",
    isin: "SE0000148884",
    name: "SEB A",
    exchangeId: "XSTO",
    currency: "SEK",
    mockBasePrice: "165.00",
  },

  // Nasdaq Copenhagen (DKK)
  {
    ticker: "NOVO B",
    isin: "DK0062498333",
    name: "Novo Nordisk B",
    exchangeId: "XCSE",
    currency: "DKK",
    mockBasePrice: "452.00",
  },
  {
    ticker: "MAERSK B",
    isin: "DK0010244508",
    name: "A.P. Møller - Mærsk B",
    exchangeId: "XCSE",
    currency: "DKK",
    mockBasePrice: "12050.00",
  },
  {
    ticker: "DSV",
    isin: "DK0060079531",
    name: "DSV",
    exchangeId: "XCSE",
    currency: "DKK",
    mockBasePrice: "1498.00",
  },
  {
    ticker: "CARL B",
    isin: "DK0010181759",
    name: "Carlsberg B",
    exchangeId: "XCSE",
    currency: "DKK",
    mockBasePrice: "852.00",
  },
  {
    ticker: "ORSTED",
    isin: "DK0060094928",
    name: "Ørsted",
    exchangeId: "XCSE",
    currency: "DKK",
    mockBasePrice: "131.40",
  },

  // Nasdaq (USD)
  {
    ticker: "AAPL",
    isin: "US0378331005",
    name: "Apple",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "231.50",
  },
  {
    ticker: "MSFT",
    isin: "US5949181045",
    name: "Microsoft",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "452.30",
  },
  {
    ticker: "NVDA",
    isin: "US67066G1040",
    name: "Nvidia",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "181.20",
  },
  {
    ticker: "AMZN",
    isin: "US0231351067",
    name: "Amazon",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "221.80",
  },
  {
    ticker: "GOOGL",
    isin: "US02079K3059",
    name: "Alphabet A",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "201.40",
  },
  {
    ticker: "META",
    isin: "US30303M1027",
    name: "Meta Platforms",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "702.00",
  },
  {
    ticker: "TSLA",
    isin: "US88160R1014",
    name: "Tesla",
    exchangeId: "XNAS",
    currency: "USD",
    mockBasePrice: "398.70",
  },

  // NYSE (USD)
  {
    ticker: "JPM",
    isin: "US46625H1005",
    name: "JPMorgan Chase",
    exchangeId: "XNYS",
    currency: "USD",
    mockBasePrice: "281.30",
  },
  {
    ticker: "KO",
    isin: "US1912161007",
    name: "Coca-Cola",
    exchangeId: "XNYS",
    currency: "USD",
    mockBasePrice: "70.20",
  },
  {
    ticker: "DIS",
    isin: "US2546871060",
    name: "Walt Disney",
    exchangeId: "XNYS",
    currency: "USD",
    mockBasePrice: "114.60",
  },
  {
    ticker: "V",
    isin: "US92826C8394",
    name: "Visa",
    exchangeId: "XNYS",
    currency: "USD",
    mockBasePrice: "342.10",
  },
  {
    ticker: "NKE",
    isin: "US6541061031",
    name: "Nike",
    exchangeId: "XNYS",
    currency: "USD",
    mockBasePrice: "75.40",
  },
];

/** Fallback for instruments added later without a mock price. */
export const DEFAULT_MOCK_BASE_PRICE = "100.00";
