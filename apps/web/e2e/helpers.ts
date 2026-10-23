import { type BrowserContext, expect, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";
const TIME_COOKIE = "aksjeliga-time";

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Created: string;
}

/** The newest sign-in link Mailpit received for an address after `since`. */
async function magicLinkFor(email: string, since: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`,
    );
    const { messages } = (await response.json()) as { messages: MailpitMessage[] };
    const fresh = messages.find((message) => Date.parse(message.Created) >= since - 2000);
    if (fresh) {
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as {
        Text: string;
        HTML: string;
      };
      const match = /https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+/.exec(
        detail.HTML || detail.Text,
      );
      if (match) return match[0].replace(/&amp;/g, "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No sign-in email for ${email}`);
}

/** Signs in through the real magic-link flow, reading the email from Mailpit. */
export async function signIn(page: Page, email: string, next = "/"): Promise<void> {
  const since = Date.now();
  await page.goto(`/logg-inn?neste=${encodeURIComponent(next)}`);
  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Send innloggingslenke" }).click();
  await expect(page.getByText("Sjekk e-posten din")).toBeVisible();
  await page.goto(await magicLinkFor(email, since));
}

/** One shared reference point, so every browser in a test sees exactly the same clock. */
const CLOCK_BASE = Date.now();

/**
 * Moves the app's clock (dev time machine) for this browser context: the app's time is
 * `iso` plus the real time passed since the test started. Same `iso` = same clock everywhere.
 */
export async function setTime(context: BrowserContext, iso: string): Promise<void> {
  await context.addCookies([
    {
      name: TIME_COOKIE,
      value: `${new Date(iso).toISOString()}|${String(CLOCK_BASE)}`,
      url: "http://localhost:3000",
    },
  ]);
}

export function uniqueEmail(name: string): string {
  return `${name}-${String(Date.now())}@test.no`;
}
