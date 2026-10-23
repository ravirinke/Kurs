import type { Decimal, Money } from "@aksjeliga/core";

import { arrow, direction, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLOR = {
  up: "text-positive",
  down: "text-negative",
  flat: "text-muted-foreground",
} as const;

/**
 * An up/down value: colour AND sign AND arrow, never colour alone (accessibility).
 * "▲ +2,34 %" or "▼ −1 200,00 kr".
 */
export function Change({
  fraction,
  amount,
  className,
  showArrow = true,
}: {
  fraction?: Decimal | null;
  amount?: Money | null;
  className?: string;
  showArrow?: boolean;
}) {
  const basis = fraction ?? amount?.amount ?? null;
  if (basis === null) return <span className={cn("text-muted-foreground", className)}>–</span>;
  const dir = direction(basis, fraction ? 4 : 2);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", COLOR[dir], className)}>
      {showArrow && dir !== "flat" && (
        <span aria-hidden className="mr-0.5 text-[0.8em]">
          {arrow(dir)}
        </span>
      )}
      {fraction ? formatPercent(fraction) : null}
      {fraction && amount ? " " : null}
      {amount
        ? fraction
          ? `(${formatMoney(amount, { signed: true })})`
          : formatMoney(amount, { signed: true })
        : null}
    </span>
  );
}
