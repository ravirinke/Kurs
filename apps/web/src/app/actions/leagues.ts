"use server";

import {
  APP_TIME_ZONE,
  type Currency,
  defaultLeagueSettings,
  isLeagueCurrency,
  type LeagueSettings,
  Money,
  suggestEndTime,
  suggestStartTime,
  type Visibility,
} from "@aksjeliga/core";
import {
  cancelLeague,
  createLeague,
  decideJoinRequest,
  joinLeague,
  loadExchanges,
  loadLeague,
  loadLeagueByInviteCode,
  regenerateInviteCode,
  removeMember,
  updateLeague,
} from "@aksjeliga/db";
import { DateTime } from "luxon";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { t } from "@/i18n";
import { type CodedError, errorMessage } from "@/lib/errors";
import { field, parseDecimalInput } from "@/lib/parse";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireProfile } from "@/server/session";

export type FieldErrors = Partial<Record<string, string>>;
export type CreateLeagueState =
  { status: "idle" } | { status: "error"; errors: FieldErrors; message?: string };

/** Which form field a settings error belongs to, so it is shown in the right place. */
const ERROR_FIELD: Record<string, string> = {
  NAME_REQUIRED: "name",
  NAME_TOO_LONG: "name",
  DESCRIPTION_TOO_LONG: "description",
  UNSUPPORTED_CURRENCY: "currency",
  START_AMOUNT_INVALID: "startAmount",
  FEE_INVALID: "fee",
  NO_EXCHANGES: "exchanges",
  UNKNOWN_EXCHANGE: "exchanges",
  START_IN_PAST: "start",
  END_BEFORE_START: "end",
  END_IN_PAST: "end",
  END_BEFORE_MARKET_CLOSE: "end",
  MAX_POSITION_SHARE_INVALID: "maxShare",
};

async function exchangeNames(): Promise<Record<string, string>> {
  const exchanges = await loadExchanges(getDb());
  return Object.fromEntries(exchanges.map((exchange) => [exchange.id, exchange.name]));
}

async function toFieldErrors(errors: readonly CodedError[]): Promise<FieldErrors> {
  const names = await exchangeNames();
  const result: FieldErrors = {};
  for (const error of errors) {
    const key = ERROR_FIELD[error.code] ?? "form";
    result[key] ??= errorMessage(error, names);
  }
  return result;
}

const VISIBILITIES: readonly Visibility[] = ["open", "delayed", "hidden"];

export async function createLeagueAction(
  _previous: CreateLeagueState,
  form: FormData,
): Promise<CreateLeagueState> {
  const { user } = await requireProfile("/ligaer/ny");
  const now = await serverNow();
  const db = getDb();
  const exchanges = await loadExchanges(db);

  const currencyInput = field(form, "currency");
  if (!isLeagueCurrency(currencyInput))
    return { status: "error", errors: { currency: t.errors.UNSUPPORTED_CURRENCY } };
  const currency: Currency = currencyInput;
  const defaults = defaultLeagueSettings(currency, exchanges);
  const errors: FieldErrors = {};

  const startAmount = parseDecimalInput(field(form, "startAmount"));
  if (!startAmount) errors["startAmount"] = t.errors.START_AMOUNT_INVALID;

  const allowedExchangeIds = form
    .getAll("exchanges")
    .filter((value): value is string => typeof value === "string");
  const selected = exchanges.filter((exchange) => allowedExchangeIds.includes(exchange.id));

  // Start: next market open (default), now, or a chosen local time.
  const startMode = field(form, "startMode");
  let startsAt = suggestStartTime(selected, now);
  if (startMode === "now") startsAt = now;
  if (startMode === "custom") {
    const custom = DateTime.fromISO(field(form, "startCustom"), { zone: APP_TIME_ZONE });
    if (custom.isValid) startsAt = custom;
    else errors["start"] = t.errors.START_IN_PAST;
  }

  // End: the chosen date, at the time all chosen exchanges have closed.
  const endDate = field(form, "endDate");
  const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ? suggestEndTime(endDate, APP_TIME_ZONE, selected)
    : null;
  if (!endsAt) errors["end"] = t.errors.END_BEFORE_START;

  const feePercent = parseDecimalInput(field(form, "feePercent"));
  const feeMinimum = parseDecimalInput(field(form, "feeMinimum"));
  if (!feePercent || !feeMinimum) errors["fee"] = t.errors.FEE_INVALID;

  const maxShareEnabled = field(form, "maxShareEnabled") === "on";
  const maxSharePercent = parseDecimalInput(field(form, "maxSharePercent"));
  if (maxShareEnabled && !maxSharePercent) errors["maxShare"] = t.errors.MAX_POSITION_SHARE_INVALID;

  const visibilityInput = field(form, "visibility") as Visibility;
  const visibility = VISIBILITIES.includes(visibilityInput) ? visibilityInput : defaults.visibility;

  if (Object.keys(errors).length > 0 || !startAmount || !endsAt || !feePercent || !feeMinimum) {
    return { status: "error", errors };
  }

  const settings: LeagueSettings = {
    ...defaults,
    name: field(form, "name"),
    description: field(form, "description").trim(),
    startAmount: Money.of(startAmount, currency),
    startsAt,
    endsAt,
    visibility,
    allowedExchangeIds,
    feeRule: { rate: feePercent.dividedBy(100), minimum: Money.of(feeMinimum, currency) },
    maxPositionShare: maxShareEnabled && maxSharePercent ? maxSharePercent.dividedBy(100) : null,
  };
  const result = await createLeague(db, { ownerId: user.id, settings, now });
  if (!result.ok) return { status: "error", errors: await toFieldErrors(result.errors) };
  redirect(`/ligaer/${result.leagueId}?fane=om&ny=1` as Route);
}

export type JoinState = { status: "idle" } | { status: "error"; message: string };

/** "Bli med i liga": the code typed in, or the button on an invite link page. */
export async function joinByCodeAction(_previous: JoinState, form: FormData): Promise<JoinState> {
  const code = field(form, "code");
  const { user } = await requireProfile(`/bli-med/${encodeURIComponent(code)}`);
  const result = await joinLeague(getDb(), {
    userId: user.id,
    inviteCode: code,
    now: await serverNow(),
  });
  if (!result.ok) {
    if (result.rejection.code === "ALREADY_MEMBER") {
      const league = await loadLeagueByCodeSafe(code);
      if (league) redirect(`/ligaer/${league}` as Route);
    }
    return { status: "error", message: errorMessage(result.rejection) };
  }
  revalidatePath("/");
  if (result.status === "joined") redirect(`/ligaer/${result.leagueId}` as Route);
  redirect(`/bli-med/${encodeURIComponent(code)}?sendt=1` as Route);
}

async function loadLeagueByCodeSafe(code: string): Promise<string | null> {
  return (await loadLeagueByInviteCode(getDb(), code))?.id ?? null;
}

/** Owner: approve or decline a late join request (from the banner on the league page). */
export async function decideJoinRequestAction(
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const { user } = await requireProfile();
  const decision = field(form, "decision") === "approve" ? "approve" : "decline";
  const name = field(form, "name");
  const result = await decideJoinRequest(getDb(), {
    requestId: field(form, "requestId"),
    deciderId: user.id,
    decision,
    now: await serverNow(),
  });
  revalidatePath(`/ligaer/${field(form, "leagueId")}`);
  if (!result.ok) return { ok: false, message: errorMessage(result.rejection) };
  return {
    ok: true,
    message: decision === "approve" ? t.league.approved(name) : t.league.declined(name),
  };
}

export type SettingsState =
  { status: "idle" } | { status: "saved" } | { status: "error"; errors: FieldErrors };

/** Owner: name, description and end date (everything else is locked after the start). */
export async function updateLeagueAction(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const leagueId = field(form, "leagueId");
  const { user } = await requireProfile(`/ligaer/${leagueId}/innstillinger`);
  const db = getDb();
  const league = await loadLeague(db, leagueId);
  if (!league) return { status: "error", errors: { form: t.errors.LEAGUE_NOT_FOUND } };

  const exchanges = (await loadExchanges(db)).filter((exchange) =>
    league.allowedExchangeIds.includes(exchange.id),
  );
  const endDate = field(form, "endDate");
  const endsAt = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ? suggestEndTime(endDate, APP_TIME_ZONE, exchanges)
    : null;
  if (!endsAt) return { status: "error", errors: { end: t.errors.END_IN_PAST } };

  const result = await updateLeague(db, {
    leagueId,
    userId: user.id,
    patch: {
      name: field(form, "name"),
      description: field(form, "description").trim(),
      ...(endsAt.equals(league.endsAt) ? {} : { endsAt }),
    },
    now: await serverNow(),
  });
  if (!result.ok) return { status: "error", errors: await toFieldErrors(result.errors) };
  revalidatePath(`/ligaer/${leagueId}`, "layout");
  return { status: "saved" };
}

export async function regenerateInviteCodeAction(
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const leagueId = field(form, "leagueId");
  const { user } = await requireProfile();
  const result = await regenerateInviteCode(getDb(), {
    leagueId,
    userId: user.id,
    now: await serverNow(),
  });
  revalidatePath(`/ligaer/${leagueId}`, "layout");
  return result.ok
    ? { ok: true, message: t.settings.regenerated(result.inviteCode) }
    : { ok: false, message: errorMessage(result.rejection) };
}

export async function removeMemberAction(
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const leagueId = field(form, "leagueId");
  const { user } = await requireProfile();
  const result = await removeMember(getDb(), {
    leagueId,
    userId: user.id,
    targetUserId: field(form, "userId"),
    now: await serverNow(),
  });
  revalidatePath(`/ligaer/${leagueId}`, "layout");
  return result.ok
    ? { ok: true, message: t.settings.removed(field(form, "name")) }
    : { ok: false, message: errorMessage(result.rejection) };
}

export async function cancelLeagueAction(
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const leagueId = field(form, "leagueId");
  const { user } = await requireProfile();
  const result = await cancelLeague(getDb(), { leagueId, userId: user.id, now: await serverNow() });
  if (!result.ok) return { ok: false, message: errorMessage(result.rejection) };
  revalidatePath("/");
  redirect("/");
}
