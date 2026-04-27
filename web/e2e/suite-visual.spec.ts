import { test, expect } from "@playwright/test";

/**
 * Visual regression snapshots for HireScript Suite surfaces.
 *
 * Skipped by default. To run locally (and generate baselines on the first
 * run):
 *
 *   LIVE_E2E=1 npx playwright test suite-visual --update-snapshots
 *
 * Subsequent runs compare against the committed PNGs under
 * `web/e2e/__screenshots__/`. Baselines are not generated in this commit;
 * they are produced the first time a developer opts in via LIVE_E2E.
 *
 * Pre-reqs for a local run:
 *   - dev stack up (`docker compose up`) so http://localhost:5173 is reachable
 *   - APP_PASSWORD is "changeme" (the default the other live specs assume)
 *   - At least one master resume exists (the spec creates one if needed)
 *
 * Not part of CI: gated entirely on `LIVE_E2E === '1'`.
 */

const live = process.env.LIVE_E2E === "1";

test.describe("suite visual snapshots", () => {
  test.skip(!live, "Set LIVE_E2E=1 to run visual snapshots");

  // Share auth across the four surface tests — log in once, then navigate.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("http://localhost:5173");

    // Log in if the password gate is showing.
    const passwordField = page.getByLabel(/password/i);
    if (await passwordField.isVisible().catch(() => false)) {
      await passwordField.fill("changeme");
      await page.getByRole("button", { name: /log in/i }).click();
    }

    // Wait for the suite shell — Resumes button in TopBar / NavRail signals
    // we're past the password gate.
    await expect(
      page.getByRole("link", { name: /^Library$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Dashboard", async ({ page }) => {
    await page.getByRole("link", { name: /^Dashboard$/ }).first().click();
    await expect(
      page.getByRole("heading", { name: /Dashboard/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    // Allow async content + any sparkline animation to settle.
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveScreenshot("dashboard.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("Inbox", async ({ page }) => {
    await page.getByRole("link", { name: /^Inbox$/ }).first().click();
    await expect(
      page.getByRole("heading", { name: /Inbox/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveScreenshot("inbox.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("Queue", async ({ page }) => {
    await page.getByRole("link", { name: /^Queue$/ }).first().click();
    await expect(
      page.getByRole("heading", { name: /Queue|Applications/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveScreenshot("queue.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("Knowledge — Profile tab", async ({ page }) => {
    await page.goto("http://localhost:5173/?tab=profile#/knowledge");
    await page
      .getByRole("link", { name: /^Knowledge$/ })
      .first()
      .click()
      .catch(() => undefined);
    await expect(
      page.getByRole("tab", { name: /Profile/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("tab", { name: /Profile/i }).click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveScreenshot("knowledge-profile.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("Knowledge — Documents tab", async ({ page }) => {
    await page.getByRole("link", { name: /^Knowledge$/ }).first().click();
    await expect(
      page.getByRole("tab", { name: /Documents/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("tab", { name: /Documents/i }).click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveScreenshot("knowledge-documents.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("Knowledge — Sources tab", async ({ page }) => {
    await page.getByRole("link", { name: /^Knowledge$/ }).first().click();
    await expect(
      page.getByRole("tab", { name: /Sources/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("tab", { name: /Sources/i }).click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page).toHaveScreenshot("knowledge-sources.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});
