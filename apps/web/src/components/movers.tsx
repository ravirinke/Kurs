import type { Decimal } from "@aksjeliga/core";
import type { Route } from "next";
import Link from "next/link";

import { t } from "@/i18n";

import { Change } from "./change";

export interface Mover {
  key: string;
  label: string;
  sublabel?: string;
  fraction: Decimal;
  href?: Route;
}

function MoverList({ title, movers }: { title: string; movers: Mover[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {movers.length === 0 ? (
        <p className="text-muted-foreground text-sm">–</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {movers.map((mover) => {
            const content = (
              <>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{mover.label}</span>
                  {mover.sublabel && (
                    <span className="text-muted-foreground truncate text-xs">{mover.sublabel}</span>
                  )}
                </span>
                <Change fraction={mover.fraction} className="text-sm font-semibold" />
              </>
            );
            return (
              <li key={mover.key}>
                {mover.href ? (
                  <Link
                    href={mover.href}
                    className="hover:bg-muted flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Dagens vinnere" and "Dagens tapere" side by side, as on a broker's front page. */
export function Movers({ winners, losers }: { winners: Mover[]; losers: Mover[] }) {
  if (winners.length === 0 && losers.length === 0) {
    return <p className="text-muted-foreground text-sm">{t.league.noMovesToday}</p>;
  }
  return (
    <div className="bg-card grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
      <MoverList title={t.league.winnersToday} movers={winners} />
      <MoverList title={t.league.losersToday} movers={losers} />
    </div>
  );
}
