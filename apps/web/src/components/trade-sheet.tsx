"use client";

import type { TradeSide } from "@aksjeliga/core";
import { Clock, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { confirmTrade, type QuoteView, requestQuote } from "@/app/actions/trade";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { FormError } from "./form-error";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";

interface TradeTarget {
  leagueId: string;
  instrumentId: string;
  instrumentName: string;
  /** Shares held, as a plain decimal string. */
  ownedQuantity: string;
  /** Cash balance, as a plain decimal string. */
  cash: string;
  /** Formatted for display ("35 340,18 kr", "12 stk"). */
  cashLabel: string;
  currencyLabel: string;
}

type Phase = "edit" | "quoting" | "quoted" | "confirming";

/** The Kjøp / Selg buttons on the stock page, each opening the trade sheet. */
export function TradeButtons(props: TradeTarget & { disabled?: boolean }) {
  const [side, setSide] = useState<TradeSide | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="lg"
          className="bg-positive hover:bg-positive/90 text-white"
          disabled={props.disabled}
          onClick={() => setSide("buy")}
        >
          {t.trade.buy}
        </Button>
        <Button
          size="lg"
          className="bg-negative hover:bg-negative/90 text-white"
          disabled={props.disabled === true || props.ownedQuantity === "0"}
          onClick={() => setSide("sell")}
        >
          {t.trade.sell}
        </Button>
      </div>
      {side && <TradeSheet {...props} side={side} onClose={() => setSide(null)} />}
    </>
  );
}

function TradeSheet({
  side,
  onClose,
  ...target
}: TradeTarget & { side: TradeSide; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"quantity" | "amount">("quantity");
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>("edit");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const deadline = useRef(0);
  // One key per trade: a double click or a retry can never trade twice.
  const idempotencyKey = useRef(crypto.randomUUID());
  const [, startTransition] = useTransition();

  const fetchQuote = useCallback(
    (request: { mode: "quantity" | "amount"; value: string }, isRefresh: boolean) => {
      setPhase("quoting");
      setError(null);
      startTransition(async () => {
        const result = await requestQuote({
          leagueId: target.leagueId,
          instrumentId: target.instrumentId,
          side,
          ...request,
        });
        if (!result.ok) {
          setError(result.message);
          setQuote(null);
          setPhase("edit");
          return;
        }
        deadline.current = Date.now() + result.quote.expiresInMs;
        setSecondsLeft(Math.ceil(result.quote.expiresInMs / 1000));
        setQuote(result.quote);
        setRefreshed(isRefresh);
        setPhase("quoted");
      });
    },
    [side, target.instrumentId, target.leagueId],
  );

  // Countdown; when the price expires, fetch a new one for the same number of shares.
  useEffect(() => {
    if (phase !== "quoted" || !quote) return;
    const id = window.setInterval(() => {
      const left = Math.ceil((deadline.current - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(id);
        fetchQuote({ mode: "quantity", value: quote.quantityRaw }, true);
      }
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [phase, quote, fetchQuote]);

  function confirm() {
    if (!quote) return;
    setPhase("confirming");
    startTransition(async () => {
      const result = await confirmTrade({
        leagueId: target.leagueId,
        instrumentId: target.instrumentId,
        instrumentName: target.instrumentName,
        quoteId: quote.quoteId,
        idempotencyKey: idempotencyKey.current,
      });
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
        onClose();
        return;
      }
      setError(result.message);
      if (result.retry) fetchQuote({ mode: "quantity", value: quote.quantityRaw }, true);
      else setPhase("quoted");
    });
  }

  const title =
    side === "buy"
      ? t.trade.sheet.buyTitle(target.instrumentName)
      : t.trade.sheet.sellTitle(target.instrumentName);
  const busy = phase === "quoting" || phase === "confirming";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="font-display text-xl">{title}</SheetTitle>
          <SheetDescription>
            {side === "buy"
              ? `${t.trade.cash}: ${target.cashLabel}`
              : t.portfolio.quantity(target.ownedQuantity)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {side === "buy" && (
            <div className="bg-muted flex gap-1 rounded-full p-1 text-sm" role="radiogroup">
              {(["quantity", "amount"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={mode === option}
                  className={cn(
                    "flex-1 rounded-full px-3 py-1.5 font-medium",
                    mode === option ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                  onClick={() => {
                    setMode(option);
                    setValue("");
                    setQuote(null);
                    setPhase("edit");
                  }}
                >
                  {option === "quantity" ? t.trade.sheet.byQuantity : t.trade.sheet.byAmount}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              fetchQuote({ mode, value }, false);
            }}
          >
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="trade-value">
                {mode === "quantity"
                  ? t.trade.sheet.quantity
                  : t.trade.sheet.amount(target.currencyLabel)}
              </Label>
              <Input
                id="trade-value"
                inputMode={mode === "quantity" ? "numeric" : "decimal"}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (phase === "quoted") {
                    setQuote(null);
                    setPhase("edit");
                  }
                }}
                className="text-lg"
                autoFocus
                required
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (side === "buy") {
                  setMode("amount");
                  setValue(target.cash);
                  fetchQuote({ mode: "amount", value: target.cash }, false);
                } else {
                  setValue(target.ownedQuantity);
                  fetchQuote({ mode: "quantity", value: target.ownedQuantity }, false);
                }
              }}
            >
              {side === "buy" ? t.trade.sheet.max : t.trade.sheet.sellAll}
            </Button>
            {phase !== "quoted" && (
              <Button type="submit" disabled={busy || value.trim() === ""}>
                {phase === "quoting" ? t.trade.sheet.fetching : t.trade.sheet.getPrice}
              </Button>
            )}
          </form>

          {error && <FormError message={error} />}

          {quote && phase !== "edit" && (
            <section
              className={cn(
                "bg-muted/60 flex flex-col gap-2 rounded-xl p-4",
                refreshed && "ring-warning ring-2",
              )}
              aria-live="polite"
            >
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t.trade.sheet.breakdownTitle}
              </h3>
              <p className="tabular-nums" data-testid="quote-calculation">
                {quote.calculation}
              </p>
              <p className="text-muted-foreground tabular-nums">{quote.fee}</p>
              <p className="flex items-baseline justify-between border-t pt-2">
                <span className="font-medium">
                  {side === "buy" ? t.trade.sheet.total : t.trade.sheet.proceeds}
                </span>
                <span
                  className="font-display text-2xl font-bold tabular-nums"
                  data-testid="quote-total"
                >
                  {quote.total}
                </span>
              </p>
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                {refreshed ? (
                  <RefreshCw aria-hidden className="size-3.5" />
                ) : (
                  <Clock aria-hidden className="size-3.5" />
                )}
                {refreshed
                  ? t.trade.sheet.refreshed(secondsLeft)
                  : t.trade.sheet.locked(secondsLeft)}
              </p>
            </section>
          )}

          {quote && phase !== "edit" && (
            <Button
              size="lg"
              className={
                side === "buy"
                  ? "bg-positive hover:bg-positive/90 text-white"
                  : "bg-negative hover:bg-negative/90 text-white"
              }
              disabled={busy}
              aria-busy={phase === "confirming"}
              onClick={confirm}
            >
              {phase === "confirming"
                ? t.trade.sheet.confirming
                : side === "buy"
                  ? t.trade.sheet.confirmBuy
                  : t.trade.sheet.confirmSell}
            </Button>
          )}
          <p className="text-muted-foreground text-center text-xs">{t.trade.sheet.fakeMoney}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
