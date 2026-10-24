import { expect, test } from "@playwright/test";

import { setTime, signIn, uniqueEmail } from "./helpers";

/*
 * The last item of the brief's "done" checklist: run the finalization job and see a winner.
 * A league from Tuesday to Thursday; on Friday the dev panel runs the daily jobs.
 */
const TUESDAY = "2026-10-27T14:00:00Z";
const FRIDAY = "2026-10-30T12:00:00Z";

test("run the jobs after the end and see the winner", async ({ browser }) => {
  const context = await browser.newContext();
  await setTime(context, TUESDAY);
  const page = await context.newPage();
  await signIn(page, uniqueEmail("vinner"));
  await page.getByLabel("Visningsnavn").fill("Vinneren");
  await page.getByRole("button", { name: "Fortsett" }).click();

  await page.getByRole("link", { name: "Opprett liga" }).first().click();
  await page.getByLabel("Navn").fill("Kort liga");
  await page.getByRole("radio", { name: "Nå" }).click();
  await page.getByLabel("Sluttdato").fill("2026-10-29");
  await page.getByRole("button", { name: "Opprett liga" }).click();
  await expect(page).toHaveURL(/\/ligaer\/[0-9a-f-]+\?fane=om&ny=1/);
  const leagueUrl = page.url().split("?")[0]!;

  // --- Friday: the league is over; the daily jobs store the result -------------------------
  await setTime(context, FRIDAY);
  await page.goto("/profil");
  await page.getByRole("button", { name: "Kjør jobber nå" }).click();
  await expect(page.getByText(/^Ferdig: .* [1-9]\d* ligaer avsluttet/)).toBeVisible();

  await page.goto(leagueUrl);
  await expect(page.getByRole("heading", { name: "Endelig resultat" })).toBeVisible();
  await expect(page.getByLabel("Vinner").first()).toBeVisible();

  await context.close();
});
