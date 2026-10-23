import { expect, test } from "@playwright/test";

import { setTime, signIn, uniqueEmail } from "./helpers";

/*
 * The brief's "done" checklist, end to end in a real browser:
 * sign in, create a league, invite someone (late join + approval), trade Norwegian and US
 * stocks with FX conversion, be rejected while the exchange is closed, and see the table.
 *
 * Tuesday 27 Oct 2026 14:00 UTC = 15:00 Oslo: Oslo Børs (until 16:20) and Nasdaq (from 14:30
 * Oslo time, the week Europe is on winter time and the US is not) are both open.
 */
const TUESDAY = "2026-10-27T14:00:00Z";
const SATURDAY = "2026-10-31T12:00:00Z";

test("create a league, invite, approve, trade NOK and USD stocks, see the table", async ({
  browser,
}) => {
  // --- A new owner signs in, picks a name, and creates a league that starts now ------------
  // (Fresh users every run, so the seeded test users' leagues stay tidy.)
  const olaContext = await browser.newContext();
  await setTime(olaContext, TUESDAY);
  const ola = await olaContext.newPage();
  await signIn(ola, uniqueEmail("eier"));
  await expect(ola.getByRole("heading", { name: "Velkommen!" })).toBeVisible();
  await ola.getByLabel("Visningsnavn").fill("Eieren");
  await ola.getByRole("button", { name: "Fortsett" }).click();
  await expect(ola.getByRole("heading", { name: "Mine ligaer" })).toBeVisible();

  await ola.getByRole("link", { name: "Opprett liga" }).first().click();
  await ola.getByLabel("Navn").fill("E2E-ligaen");
  await ola.getByRole("radio", { name: "Nå" }).click();
  await ola.getByRole("button", { name: "Opprett liga" }).click();
  await expect(ola).toHaveURL(/\/ligaer\/[0-9a-f-]+\?fane=om&ny=1/);
  const leagueUrl = ola.url().split("?")[0]!;
  const code = (await ola.getByTestId("invite-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // --- A new user opens the invite link, picks a name, and asks to join --------------------
  const newContext = await browser.newContext();
  await setTime(newContext, TUESDAY);
  const newbie = await newContext.newPage();
  await signIn(newbie, uniqueEmail("ny"), `/bli-med/${code}`);
  await expect(newbie.getByRole("heading", { name: "Velkommen!" })).toBeVisible();
  await newbie.getByLabel("Visningsnavn").fill("Nyttfjes");
  await newbie.getByRole("button", { name: "Fortsett" }).click();
  await expect(newbie.getByRole("heading", { name: "Bli med i E2E-ligaen" })).toBeVisible();
  await expect(newbie.getByText(/Eieren må godkjenne deg/)).toBeVisible();
  await newbie.getByRole("button", { name: "Be om å bli med" }).click();
  await expect(newbie.getByText(/Forespørselen er sendt/)).toBeVisible();

  // --- Ola approves from the banner on the league page -------------------------------------
  await ola.goto(leagueUrl);
  await expect(ola.getByText("1 venter på godkjenning")).toBeVisible();
  await ola.getByRole("button", { name: "Godta" }).click();
  await expect(ola.getByText("Nyttfjes er med i ligaen.")).toBeVisible();

  // --- The new member buys a Norwegian stock (NOK, no conversion) ---------------------------
  await newbie.goto(leagueUrl);
  await newbie.getByRole("link", { name: "Handle" }).click();
  await newbie.getByRole("searchbox").fill("Equinor");
  await newbie.getByRole("searchbox").press("Enter");
  await newbie.getByRole("link", { name: /Equinor/ }).click();
  await newbie.getByRole("button", { name: "Kjøp", exact: true }).click();
  await newbie.getByLabel("Antall").fill("10");
  await newbie.getByRole("button", { name: "Se pris" }).click();
  await expect(newbie.getByTestId("quote-calculation")).toHaveText(
    /^10 × [\d\u00A0]+,\d{2}\u00A0kr = [\d\u00A0]+,\d{2}\u00A0kr$/,
  );
  await newbie.getByRole("button", { name: "Bekreft kjøp" }).click();
  await expect(newbie.getByText(/Kjøpt 10 Equinor for/)).toBeVisible();

  // --- Ola buys a US stock: the estimate shows the FX conversion to NOK --------------------
  await ola.goto(`${leagueUrl}/handle?q=Apple`);
  await ola.getByRole("link", { name: /Apple/ }).click();
  await ola.getByRole("button", { name: "Kjøp", exact: true }).click();
  await ola.getByLabel("Antall").fill("5");
  await ola.getByRole("button", { name: "Se pris" }).click();
  await expect(ola.getByTestId("quote-calculation")).toHaveText(
    /^5 × [\d\u00A0]+,\d{2}\u00A0USD × \d+,\d{6} = [\d\u00A0]+,\d{2}\u00A0kr$/,
  );
  await expect(ola.getByText(/\+ kurtasje 29,00\u00A0kr/)).toBeVisible();
  await ola.getByRole("button", { name: "Bekreft kjøp" }).click();
  await expect(ola.getByText(/Kjøpt 5 Apple for/)).toBeVisible();

  // --- Both are in the table ----------------------------------------------------------------
  await ola.goto(leagueUrl);
  const table = ola.getByRole("list").filter({ hasText: "Nyttfjes" });
  await expect(table.getByText("Eieren", { exact: true })).toBeVisible();
  await expect(table.getByText("Nyttfjes")).toBeVisible();

  // --- On Saturday the exchange is closed and the trade is refused --------------------------
  await setTime(olaContext, SATURDAY);
  await ola.goto(`${leagueUrl}/handle?q=Equinor`);
  await ola.getByRole("link", { name: /Equinor/ }).click();
  await expect(ola.getByText(/Stengt – åpner om/)).toBeVisible();
  await ola.getByRole("button", { name: "Kjøp", exact: true }).click();
  await ola.getByLabel("Antall").fill("1");
  await ola.getByRole("button", { name: "Se pris" }).click();
  await expect(ola.getByText(/Børsen er stengt\. Den åpner/)).toBeVisible();

  // --- The portfolio shows the holding with its return -------------------------------------
  await ola.goto(`${leagueUrl}/portefolje`);
  await expect(ola.getByTestId("portfolio-value")).toHaveText(/kr$/);
  await expect(ola.getByRole("link", { name: /Apple/ })).toBeVisible();

  await olaContext.close();
  await newContext.close();
});
