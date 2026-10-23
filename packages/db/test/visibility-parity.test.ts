import {
  DELAYED_VISIBILITY_HOURS,
  instant,
  type PortfolioAccess,
  resolvePortfolioAccess,
  type Visibility,
} from "@aksjeliga/core";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { connect } from "./helpers";

/*
 * The visibility rule exists twice: in packages/core (used by the server) and as SQL (used by
 * RLS). This test runs every combination through both and requires the same answer.
 */

const { db, close } = connect();
afterAll(close);

const SQL_NAME: Record<PortfolioAccess["kind"], string> = {
  none: "none",
  full: "full",
  delayed: "delayed",
  returnOnly: "return_only",
};

const visibilities: Visibility[] = ["open", "delayed", "hidden"];
const booleans = [false, true];

describe("visibility rule parity between core and SQL", () => {
  const combinations = visibilities.flatMap((visibility) =>
    booleans.flatMap((finished) =>
      booleans.flatMap((isMember) =>
        booleans.map((isSelf) => ({ visibility, finished, isMember, isSelf })),
      ),
    ),
  );

  it.each(combinations)("%o", async ({ visibility, finished, isMember, isSelf }) => {
    const core = resolvePortfolioAccess({
      visibility,
      leagueStatus: finished ? "finished" : "active",
      viewerIsMember: isMember,
      viewerMemberId: isMember ? (isSelf ? "target" : "viewer") : null,
      targetMemberId: "target",
      now: instant("2026-10-27T12:00:00Z"),
    });
    const [row] = await db.execute<{ access: string }>(
      sql`select public.portfolio_access_rule(${visibility}::public.visibility, ${finished}, ${isMember}, ${isSelf}) as access`,
    );
    expect(row?.access).toBe(SQL_NAME[core.kind]);
  });

  it("uses the same delay as core", async () => {
    const [row] = await db.execute<{ hours: string }>(
      sql`select extract(epoch from now() - public.delayed_visibility_cutoff()) / 3600 as hours`,
    );
    expect(Number(row?.hours)).toBe(DELAYED_VISIBILITY_HOURS);
  });
});
