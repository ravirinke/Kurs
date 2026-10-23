import type { Decimal, Money } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import { formatDate, formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ChartPoint {
  at: DateTime;
  value: Money;
}

const WIDTH = 600;
const HEIGHT = 220;
const PAD_Y = 12;

/**
 * A line chart with a soft area underneath, drawn as plain SVG. Coordinates are screen
 * geometry, so they may be JS numbers; the values they come from stay Decimals.
 */
export function PriceChart({
  points,
  intraday = false,
  direction,
  label,
  className,
}: {
  points: ChartPoint[];
  intraday?: boolean;
  direction: "up" | "down" | "flat";
  label: string;
  className?: string;
}) {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint || points.length < 2) {
    return <div className={cn("bg-muted/40 h-48 rounded-xl", className)} aria-hidden />;
  }

  const values = points.map((point) => point.value.amount);
  const min = values.reduce((a, b) => (b.lessThan(a) ? b : a));
  const max = values.reduce((a, b) => (b.greaterThan(a) ? b : a));
  const range = max.minus(min);
  const first = firstPoint.at.toMillis();
  const span = Math.max(1, lastPoint.at.toMillis() - first);

  const y = (value: Decimal) => {
    const ratio = range.isZero() ? 0.5 : Number(value.minus(min).dividedBy(range).toFixed(6));
    return PAD_Y + (1 - ratio) * (HEIGHT - 2 * PAD_Y);
  };
  // Even spacing for daily points (no gaps for weekends), time-based within a day.
  const x = (index: number, at: DateTime) =>
    intraday ? ((at.toMillis() - first) / span) * WIDTH : (index / (points.length - 1)) * WIDTH;

  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(index, point.at).toFixed(1)},${y(point.value.amount).toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;
  const stroke =
    direction === "down"
      ? "var(--negative)"
      : direction === "up"
        ? "var(--positive)"
        : "var(--muted-foreground)";
  const axisLabel = (at: DateTime) => (intraday ? formatTime(at) : formatDate(at));

  return (
    <figure className={cn("flex flex-col gap-1", className)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          className="h-52 w-full"
          role="img"
          aria-label={label}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#chart-fill)" />
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-muted-foreground absolute top-0 right-0 text-xs tabular-nums">
          {formatNumber(max)}
        </span>
        <span className="text-muted-foreground absolute right-0 bottom-0 text-xs tabular-nums">
          {formatNumber(min)}
        </span>
      </div>
      <figcaption className="text-muted-foreground flex justify-between text-xs">
        <span>{axisLabel(firstPoint.at)}</span>
        <span>{axisLabel(lastPoint.at)}</span>
      </figcaption>
    </figure>
  );
}
