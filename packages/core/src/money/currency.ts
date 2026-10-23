/** Currencies the app knows about. League currencies are a subset (LEAGUE_CURRENCIES). */
export const CURRENCIES = ["NOK", "SEK", "DKK", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const LEAGUE_CURRENCIES: readonly Currency[] = ["NOK", "SEK", "DKK", "EUR", "USD"];

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function isLeagueCurrency(value: string): value is Currency {
  return isCurrency(value) && LEAGUE_CURRENCIES.includes(value);
}
