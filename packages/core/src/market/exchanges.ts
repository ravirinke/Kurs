import type { Exchange, ExchangeHoliday, TradingSessionRule, Weekday } from "./types";

/*
 * Reference data for the supported exchanges. The database is seeded from this (phase 3).
 *
 * ⚠️  HOLIDAYS AND EARLY CLOSES FOR 2026–2027 WERE ENTERED MANUALLY.
 * ⚠️  They MUST be checked against each exchange's official trading calendar before
 * ⚠️  going live. See docs/decisions.md. Regular hours are also worth re-checking yearly.
 *
 * Only weekday holidays are listed; weekends are closed anyway.
 */

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

function weekdays(open: string, close: string): TradingSessionRule[] {
  return WEEKDAYS.map((weekday) => ({ weekday, open, close }));
}

function closed(date: string, name: string): ExchangeHoliday {
  return { date, name };
}

function early(date: string, name: string, closesEarlyAt: string): ExchangeHoliday {
  return { date, name, closesEarlyAt };
}

export const OSLO_BORS: Exchange = {
  id: "XOSL",
  name: "Oslo Børs",
  timeZone: "Europe/Oslo",
  currency: "NOK",
  sessions: weekdays("09:00", "16:20"),
  holidays: [
    closed("2026-01-01", "Første nyttårsdag"),
    early("2026-04-01", "Onsdag før skjærtorsdag", "13:00"),
    closed("2026-04-02", "Skjærtorsdag"),
    closed("2026-04-03", "Langfredag"),
    closed("2026-04-06", "Andre påskedag"),
    closed("2026-05-01", "Arbeidernes dag"),
    closed("2026-05-14", "Kristi himmelfartsdag"),
    closed("2026-05-25", "Andre pinsedag"),
    closed("2026-12-24", "Julaften"),
    closed("2026-12-25", "Første juledag"),
    closed("2026-12-31", "Nyttårsaften"),
    closed("2027-01-01", "Første nyttårsdag"),
    early("2027-03-24", "Onsdag før skjærtorsdag", "13:00"),
    closed("2027-03-25", "Skjærtorsdag"),
    closed("2027-03-26", "Langfredag"),
    closed("2027-03-29", "Andre påskedag"),
    closed("2027-05-06", "Kristi himmelfartsdag"),
    closed("2027-05-17", "Grunnlovsdag og andre pinsedag"),
    closed("2027-12-24", "Julaften"),
    closed("2027-12-31", "Nyttårsaften"),
  ],
};

export const NASDAQ_STOCKHOLM: Exchange = {
  id: "XSTO",
  name: "Nasdaq Stockholm",
  timeZone: "Europe/Stockholm",
  currency: "SEK",
  sessions: weekdays("09:00", "17:30"),
  holidays: [
    closed("2026-01-01", "Nyårsdagen"),
    early("2026-01-05", "Trettondagsafton", "13:00"),
    closed("2026-01-06", "Trettondedag jul"),
    early("2026-04-02", "Skärtorsdagen", "13:00"),
    closed("2026-04-03", "Långfredagen"),
    closed("2026-04-06", "Annandag påsk"),
    early("2026-04-30", "Valborgsmässoafton", "13:00"),
    closed("2026-05-01", "Första maj"),
    early("2026-05-13", "Dagen före Kristi himmelsfärdsdag", "13:00"),
    closed("2026-05-14", "Kristi himmelsfärdsdag"),
    closed("2026-06-19", "Midsommarafton"),
    early("2026-10-30", "Dagen före Alla helgons dag", "13:00"),
    closed("2026-12-24", "Julafton"),
    closed("2026-12-25", "Juldagen"),
    closed("2026-12-31", "Nyårsafton"),
    closed("2027-01-01", "Nyårsdagen"),
    early("2027-01-05", "Trettondagsafton", "13:00"),
    closed("2027-01-06", "Trettondedag jul"),
    early("2027-03-25", "Skärtorsdagen", "13:00"),
    closed("2027-03-26", "Långfredagen"),
    closed("2027-03-29", "Annandag påsk"),
    early("2027-04-30", "Valborgsmässoafton", "13:00"),
    early("2027-05-05", "Dagen före Kristi himmelsfärdsdag", "13:00"),
    closed("2027-05-06", "Kristi himmelsfärdsdag"),
    closed("2027-06-25", "Midsommarafton"),
    early("2027-11-05", "Dagen före Alla helgons dag", "13:00"),
    closed("2027-12-24", "Julafton"),
    closed("2027-12-31", "Nyårsafton"),
  ],
};

export const NASDAQ_COPENHAGEN: Exchange = {
  id: "XCSE",
  name: "Nasdaq Copenhagen",
  timeZone: "Europe/Copenhagen",
  currency: "DKK",
  sessions: weekdays("09:00", "17:00"),
  holidays: [
    closed("2026-01-01", "Nytårsdag"),
    closed("2026-04-02", "Skærtorsdag"),
    closed("2026-04-03", "Langfredag"),
    closed("2026-04-06", "2. påskedag"),
    closed("2026-05-14", "Kristi himmelfartsdag"),
    closed("2026-05-15", "Dagen efter Kristi himmelfartsdag"),
    closed("2026-05-25", "2. pinsedag"),
    closed("2026-06-05", "Grundlovsdag"),
    closed("2026-12-24", "Juleaftensdag"),
    closed("2026-12-25", "Juledag"),
    closed("2026-12-31", "Nytårsaftensdag"),
    closed("2027-01-01", "Nytårsdag"),
    closed("2027-03-25", "Skærtorsdag"),
    closed("2027-03-26", "Langfredag"),
    closed("2027-03-29", "2. påskedag"),
    closed("2027-05-06", "Kristi himmelfartsdag"),
    closed("2027-05-07", "Dagen efter Kristi himmelfartsdag"),
    closed("2027-05-17", "2. pinsedag"),
    closed("2027-12-24", "Juleaftensdag"),
    closed("2027-12-31", "Nytårsaftensdag"),
  ],
};

/** Nasdaq (US) and NYSE share the same holiday calendar. */
const US_HOLIDAYS: readonly ExchangeHoliday[] = [
  closed("2026-01-01", "New Year's Day"),
  closed("2026-01-19", "Martin Luther King Jr. Day"),
  closed("2026-02-16", "Washington's Birthday"),
  closed("2026-04-03", "Good Friday"),
  closed("2026-05-25", "Memorial Day"),
  closed("2026-06-19", "Juneteenth"),
  closed("2026-07-03", "Independence Day (observed)"),
  closed("2026-09-07", "Labor Day"),
  closed("2026-11-26", "Thanksgiving Day"),
  early("2026-11-27", "Day after Thanksgiving", "13:00"),
  early("2026-12-24", "Christmas Eve", "13:00"),
  closed("2026-12-25", "Christmas Day"),
  closed("2027-01-01", "New Year's Day"),
  closed("2027-01-18", "Martin Luther King Jr. Day"),
  closed("2027-02-15", "Washington's Birthday"),
  closed("2027-03-26", "Good Friday"),
  closed("2027-05-31", "Memorial Day"),
  closed("2027-06-18", "Juneteenth (observed)"),
  closed("2027-07-05", "Independence Day (observed)"),
  closed("2027-09-06", "Labor Day"),
  closed("2027-11-25", "Thanksgiving Day"),
  early("2027-11-26", "Day after Thanksgiving", "13:00"),
  closed("2027-12-24", "Christmas Day (observed)"),
];

export const NASDAQ_US: Exchange = {
  id: "XNAS",
  name: "Nasdaq",
  timeZone: "America/New_York",
  currency: "USD",
  sessions: weekdays("09:30", "16:00"),
  holidays: US_HOLIDAYS,
};

export const NYSE: Exchange = {
  id: "XNYS",
  name: "NYSE",
  timeZone: "America/New_York",
  currency: "USD",
  sessions: weekdays("09:30", "16:00"),
  holidays: US_HOLIDAYS,
};

export const EXCHANGES: readonly Exchange[] = [
  OSLO_BORS,
  NASDAQ_STOCKHOLM,
  NASDAQ_COPENHAGEN,
  NASDAQ_US,
  NYSE,
];
