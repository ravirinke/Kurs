import { devices, expect, test } from "@playwright/test";

import { setTime, signIn } from "./helpers";

/*
 * Not a test of behaviour: walks through the main pages and saves screenshots for design
 * review (test-results/screens). Run with: pnpm --filter @aksjeliga/web exec playwright test screenshots
 * Options: DARK=1 (dark mode), SCREENSHOT_TIME=<ISO> (time machine), CLEAN=1 (hide the dev
 * indicator and the time machine banner, for screenshots in the README).
 */
test.skip(!process.env["SCREENSHOTS"], "Set SCREENSHOTS=1 to take design screenshots");

test("screenshots of the main pages", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
    colorScheme: process.env["DARK"] ? "dark" : "light",
  });
  await setTime(context, process.env["SCREENSHOT_TIME"] ?? "2026-10-27T14:00:00Z");
  const page = await context.newPage();
  const style = process.env["CLEAN"]
    ? 'nextjs-portal, a[href="/profil"].bg-warning { display: none !important; }'
    : "";
  const shot = async (name: string) => {
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: `test-results/screens/${testInfo.project.name}-${name}.png`,
      fullPage: true,
      style,
    });
  };

  await signIn(page, "ola@test.no");
  await expect(page.getByRole("heading", { name: "Mine ligaer" })).toBeVisible();
  await shot("01-home");

  await page
    .getByRole("link", { name: /Testligaen/ })
    .first()
    .click();
  await page.waitForURL(/\/ligaer\/[0-9a-f-]+$/);
  await shot("02-league-table");
  const leagueUrl = page.url().split("?")[0]!;
  await page.goto(`${leagueUrl}?fane=aktivitet`);
  await shot("03-league-activity");
  await page.goto(`${leagueUrl}?fane=om`);
  await shot("04-league-about");
  await page.goto(`${leagueUrl}/handle`);
  await shot("05-trade-home");
  await page.goto(`${leagueUrl}/handle?bors=XNAS`);
  await shot("06-exchange-list");
  await page.getByRole("link", { name: /Apple/ }).click();
  await page.waitForURL(/\/aksjer\//);
  await shot("07-stock");
  await page.getByRole("button", { name: "Kjøp", exact: true }).click();
  await page.getByLabel("Antall").fill("3");
  await page.getByRole("button", { name: "Se pris" }).click();
  await expect(page.getByTestId("quote-total")).toBeVisible();
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}-08-trade-sheet.png`,
    style,
  });
  await page.keyboard.press("Escape");
  await page.goto(`${leagueUrl}/portefolje`);
  await shot("09-portfolio");
  await page.goto(leagueUrl);
  await page.getByRole("link", { name: /Kari/ }).first().click();
  await page.waitForURL(/\/medlemmer\//);
  await shot("10-other-portfolio");
  await page.goto(`${leagueUrl}/innstillinger`);
  await shot("11-settings");
  await page.goto("/ligaer/ny");
  await shot("12-create-league");
  await context.close();
});
