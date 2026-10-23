import { decimal, fxRate, identityRate, instant, type LedgerEvent, Money } from "@aksjeliga/core";
import { describe, expect, it } from "vitest";

import { cashEffect, eventToRow, rowToEvent, toNumeric } from "./mappers";
import type { transactions } from "./schema";

type TransactionRow = typeof transactions.$inferSelect;

const at = instant("2026-10-27T15:00:00Z");
const nok = (amount: string) => Money.of(amount, "NOK");

const events: LedgerEvent[] = [
  { id: "e1", type: "deposit", at, amount: nok("100000") },
  {
    id: "e2",
    type: "buy",
    at,
    instrumentId: "aapl",
    quantity: decimal("10"),
    price: Money.of("182.4", "USD"),
    fxRate: fxRate("USD", "NOK", "10.842105"),
    grossAmount: nok("19776"),
    fee: nok("29"),
    quoteId: "q1",
  },
  {
    id: "e3",
    type: "sell",
    at,
    instrumentId: "eqnr",
    quantity: decimal("5"),
    price: nok("270.5"),
    fxRate: identityRate("NOK"),
    grossAmount: nok("1352.5"),
    fee: nok("29"),
    quoteId: "q2",
  },
  { id: "e4", type: "fee", at, amount: nok("10"), description: "Test" },
  {
    id: "e5",
    type: "dividend",
    at,
    instrumentId: "eqnr",
    corporateActionId: "ca1",
    quantity: decimal("100"),
    amountPerShare: Money.of("0.37", "USD"),
    fxRate: fxRate("USD", "NOK", "10.8"),
    amount: nok("399.6"),
  },
  {
    id: "e6",
    type: "split",
    at,
    instrumentId: "aapl",
    corporateActionId: "ca2",
    ratioFrom: decimal("10"),
    ratioTo: decimal("1"),
    quantityBefore: decimal("15"),
    quantityAfter: decimal("1"),
    cashInLieu: nok("525"),
  },
];

/** What the database would return for an inserted row. */
function asStoredRow(insert: ReturnType<typeof eventToRow>): TransactionRow {
  return {
    id: insert.id ?? "",
    sequence: 1n,
    leagueId: insert.leagueId,
    memberId: insert.memberId,
    type: insert.type,
    occurredAt: insert.occurredAt,
    amount: insert.amount,
    instrumentId: insert.instrumentId ?? null,
    quantity: insert.quantity ?? null,
    price: insert.price ?? null,
    priceCurrency: insert.priceCurrency ?? null,
    fxRate: insert.fxRate ?? null,
    grossAmount: insert.grossAmount ?? null,
    fee: insert.fee ?? null,
    quoteId: insert.quoteId ?? null,
    idempotencyKey: insert.idempotencyKey ?? null,
    corporateActionId: insert.corporateActionId ?? null,
    amountPerShare: insert.amountPerShare ?? null,
    dividendCurrency: insert.dividendCurrency ?? null,
    ratioFrom: insert.ratioFrom ?? null,
    ratioTo: insert.ratioTo ?? null,
    quantityBefore: insert.quantityBefore ?? null,
    quantityAfter: insert.quantityAfter ?? null,
    description: insert.description ?? null,
    createdAt: new Date(0),
  };
}

describe("ledger event ↔ transaction row", () => {
  it.each(events.map((event) => [event.type, event] as const))(
    "round-trips a %s",
    (_type, event) => {
      const row = asStoredRow(
        eventToRow(event, { leagueId: "l", memberId: "m", idempotencyKey: "k" }),
      );
      expect(JSON.stringify(rowToEvent(row, "NOK"))).toBe(JSON.stringify(event));
    },
  );

  it("stores the signed effect on cash", () => {
    expect(events.map((event) => cashEffect(event).amount.toFixed())).toEqual([
      "100000",
      "-19805",
      "1323.5",
      "-10",
      "399.6",
      "525",
    ]);
  });

  it("requires an idempotency key for trades", () => {
    expect(() => eventToRow(events[1]!, { leagueId: "l", memberId: "m" })).toThrow(
      /idempotencyKey/,
    );
  });
});

describe("toNumeric", () => {
  it("never uses exponent notation", () => {
    expect(toNumeric(decimal("0.0000001"))).toBe("0.0000001");
    expect(toNumeric(decimal("123456789012345678901234567890"))).toBe(
      "123456789012345678901234567890",
    );
  });
});
