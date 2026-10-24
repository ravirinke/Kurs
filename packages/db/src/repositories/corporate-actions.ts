import {
  type CorporateAction,
  decimal,
  type DividendAction,
  Money,
  type SplitAction,
} from "@aksjeliga/core";
import { and, asc, inArray, isNull } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { toDateTime, toDbTime, toNumeric } from "../mappers";
import { corporateActions, simulatedCorporateActions } from "../schema";

/** A split or dividend before it has an id. */
export type NewCorporateAction = Omit<SplitAction, "id"> | Omit<DividendAction, "id">;

type ActionRow =
  typeof corporateActions.$inferSelect | typeof simulatedCorporateActions.$inferSelect;

function required<T>(value: T | null, field: string): T {
  if (value === null) throw new Error(`Missing ${field} in corporate action row`);
  return value;
}

function toCorporateAction(row: ActionRow, id: string): CorporateAction {
  if (row.kind === "split") {
    return {
      kind: "split",
      id,
      instrumentId: row.instrumentId,
      effectiveDate: required(row.effectiveDate, "effective_date"),
      ratioFrom: decimal(required(row.ratioFrom, "ratio_from")),
      ratioTo: decimal(required(row.ratioTo, "ratio_to")),
    };
  }
  return {
    kind: "dividend",
    id,
    instrumentId: row.instrumentId,
    exDate: required(row.exDate, "ex_date"),
    payDate: required(row.payDate, "pay_date"),
    amountPerShare: Money.of(
      required(row.amountPerShare, "amount_per_share"),
      required(row.currency, "currency"),
    ),
  };
}

function actionFields(action: NewCorporateAction) {
  return action.kind === "split"
    ? {
        instrumentId: action.instrumentId,
        kind: action.kind,
        effectiveDate: action.effectiveDate,
        ratioFrom: toNumeric(action.ratioFrom),
        ratioTo: toNumeric(action.ratioTo),
      }
    : {
        instrumentId: action.instrumentId,
        kind: action.kind,
        exDate: action.exDate,
        payDate: action.payDate,
        amountPerShare: toNumeric(action.amountPerShare.amount),
        currency: action.amountPerShare.currency,
      };
}

/** A corporate action as stored by us. `action.id` is our id (what transactions refer to). */
export interface StoredCorporateAction {
  externalId: string;
  action: CorporateAction;
  processedAt: DateTime | null;
}

/**
 * Stores actions reported by the PriceProvider (their `id` is the provider's id) and returns
 * them as stored, keyed by the provider's id. Fetching the same action again stores nothing.
 */
export async function storeCorporateActions(
  db: Executor,
  reported: readonly CorporateAction[],
): Promise<Map<string, StoredCorporateAction>> {
  if (reported.length === 0) return new Map();
  await db
    .insert(corporateActions)
    .values(reported.map((action) => ({ externalId: action.id, ...actionFields(action) })))
    .onConflictDoNothing({ target: corporateActions.externalId });
  return findCorporateActions(
    db,
    reported.map((action) => action.id),
  );
}

/** Stored actions by the provider's ids (missing ones are simply absent). */
export async function findCorporateActions(
  db: Executor,
  externalIds: readonly string[],
): Promise<Map<string, StoredCorporateAction>> {
  if (externalIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(corporateActions)
    .where(inArray(corporateActions.externalId, [...externalIds]));
  return new Map(
    rows.map((row) => [
      row.externalId,
      {
        externalId: row.externalId,
        action: toCorporateAction(row, row.id),
        processedAt: row.processedAt ? toDateTime(row.processedAt) : null,
      },
    ]),
  );
}

export async function markCorporateActionsProcessed(
  db: Executor,
  ids: readonly string[],
  now: DateTime,
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(corporateActions)
    .set({ processedAt: toDbTime(now) })
    .where(and(inArray(corporateActions.id, [...ids]), isNull(corporateActions.processedAt)));
}

/** Dev only: the actions the mock provider should pretend the market had. */
export async function loadSimulatedCorporateActions(db: Executor): Promise<CorporateAction[]> {
  const rows = await db
    .select()
    .from(simulatedCorporateActions)
    .orderBy(asc(simulatedCorporateActions.createdAt));
  return rows.map((row) => toCorporateAction(row, row.id));
}

/** Dev only: adds a simulated split or dividend. Returns its id. */
export async function addSimulatedCorporateAction(
  db: Executor,
  action: NewCorporateAction,
): Promise<string> {
  const [row] = await db
    .insert(simulatedCorporateActions)
    .values(actionFields(action))
    .returning({ id: simulatedCorporateActions.id });
  if (!row) throw new Error("Insert returned no row");
  return row.id;
}
