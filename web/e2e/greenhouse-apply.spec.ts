import { test, expect, Page } from "@playwright/test";

/**
 * Greenhouse end-to-end smoke for Slice 2.
 *
 * Walks the full happy path:
 *
 *   seed posting (admin/seed-posting) → Inbox → Prepare → Review queue
 *   → assert resume PDF + cover letter + Submit → (optional) Submit
 *
 * Gated behind the LIVE_E2E env var because the orchestrator hits
 * Anthropic + Voyage. Run locally with:
 *
 *   E2E_TESTING=1 LIVE_E2E=1 npx playwright test greenhouse-apply
 *
 * The optional live-submit branch is further gated by
 * LIVE_GREENHOUSE_TARGET — set it to a real, currently-open Greenhouse
 * application URL the test is allowed to submit to. The test will use
 * that URL as the apply_url for the seeded posting.
 *
 * This spec assumes the API was started with E2E_TESTING=1 so the
 * /admin/seed-posting route is registered (otherwise it 404s).
 */

const APP_PASSWORD = process.env.APP_PASSWORD ?? "changeme";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

async function login(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // If already logged in this will be a no-op redirect; otherwise show form.
  const pwd = page.getByLabel(/password/i);
  if (await pwd.count()) {
    await pwd.fill(APP_PASSWORD);
    await page.getByRole("button", { name: /log in/i }).click();
  }
  // Wait for the top chrome (Resumes nav button) to render.
  await expect(page.getByRole("button", { name: /^resumes$/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function seedPosting(
  page: Page,
  overrides: Partial<{
    company_slug: string;
    company_name: string;
    source_job_id: string;
    title: string;
    apply_url: string;
    description_text: string;
    location: string;
  }> = {},
): Promise<{ id: number }> {
  const stamp = Date.now();
  const body = {
    company_slug: overrides.company_slug ?? `e2e-co-${stamp}`,
    company_name: overrides.company_name ?? "E2E Test Company",
    source: "greenhouse",
    source_job_id: overrides.source_job_id ?? `e2e-${stamp}`,
    title: overrides.title ?? "Senior Software Engineer (E2E)",
    apply_url:
      overrides.apply_url ??
      `https://boards.greenhouse.io/example/jobs/${stamp}`,
    description_text:
      overrides.description_text ??
      "We are hiring a senior backend engineer with experience in Python, FastAPI, and async systems. You will design distributed services, mentor teammates, and ship production-quality code.",
    location: overrides.location ?? "Remote",
    tier: "targeted",
    fit_score: 80,
    status: "classified",
  };
  const res = await page.request.post(`${BASE_URL}/api/admin/seed-posting`, {
    data: body,
  });
  if (!res.ok()) {
    throw new Error(
      `seed-posting failed (${res.status()}): ${await res.text()}. ` +
        `Did you start the API with E2E_TESTING=1?`,
    );
  }
  const json = (await res.json()) as { id: number };
  return { id: json.id };
}

async function openInbox(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^inbox$/i }).click();
  await expect(
    page.getByRole("heading", { level: 1 }).or(page.locator("text=Inbox").first()),
  ).toBeVisible({ timeout: 10_000 });
}

async function openApplications(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^applications$/i }).click();
  await page.waitForURL(/\/(?!jobs).*$/);
}

test.describe("greenhouse apply smoke", () => {
  test.skip(!process.env.LIVE_E2E, "LIVE_E2E env var not set");

  test("seed posting → prepare → review queue card", async ({ page }) => {
    test.setTimeout(180_000);

    await login(page);
    const { id: postingId } = await seedPosting(page);

    await openInbox(page);

    // Wait for our seeded posting to appear, then click Prepare on it.
    const card = page.locator(`[data-testid="posting-card"][data-posting-id="${postingId}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.locator('[data-testid="posting-prepare-btn"]').click();

    // Prepare navigates to /jobs?batch=...; we don't strictly assert that —
    // just give the orchestrator time and then poll the Applications view
    // for the corresponding application row.
    await page.waitForURL(/\/jobs(\?|$)/, { timeout: 10_000 }).catch(() => {});

    // Poll up to 120s for the prepare orchestrator (tailor + cover letter +
    // form fill + compile) to land an application row.
    const appCard = page
      .locator('[data-testid="application-card"]')
      .first();

    const deadline = Date.now() + 120_000;
    let foundApp = false;
    while (Date.now() < deadline) {
      await openApplications(page);
      if ((await appCard.count()) > 0) {
        foundApp = true;
        break;
      }
      await page.waitForTimeout(3000);
    }
    expect(
      foundApp,
      "expected at least one application card in the review queue",
    ).toBe(true);

    // Resume pane (PDF preview) is rendered.
    await expect(
      appCard.locator('[data-testid="app-resume-pane"]'),
    ).toBeVisible();

    // Cover letter section is present.
    await expect(
      appCard.locator('[data-testid="app-cover-letter-heading"]'),
    ).toBeVisible();

    // Submit button is rendered (and enabled for prepared apps).
    await expect(
      appCard.locator('[data-testid="app-submit-btn"]'),
    ).toBeVisible();
  });

  test("live submit to a real greenhouse posting", async ({ page }) => {
    test.skip(
      !process.env.LIVE_GREENHOUSE_TARGET,
      "LIVE_GREENHOUSE_TARGET not set",
    );
    test.setTimeout(300_000);

    await login(page);

    const applyUrl = process.env.LIVE_GREENHOUSE_TARGET as string;
    const { id: postingId } = await seedPosting(page, {
      apply_url: applyUrl,
      title: "Live Greenhouse E2E target",
    });

    await openInbox(page);
    const card = page.locator(
      `[data-testid="posting-card"][data-posting-id="${postingId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.locator('[data-testid="posting-prepare-btn"]').click();

    // Wait for application to appear.
    const appCard = page
      .locator('[data-testid="application-card"]')
      .first();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await openApplications(page);
      if ((await appCard.count()) > 0) break;
      await page.waitForTimeout(3000);
    }
    await expect(appCard).toBeVisible();

    // Click Submit; confirm the submit job navigates to /jobs?job=...
    await appCard.locator('[data-testid="app-submit-btn"]').click();
    await page.waitForURL(/\/jobs\?job=/, { timeout: 10_000 });

    // Watch for the application status to flip to "submitted" within ~90s.
    // The Applications page is our source of truth.
    const submittedDeadline = Date.now() + 120_000;
    let submitted = false;
    while (Date.now() < submittedDeadline) {
      await openApplications(page);
      const submittedCard = page.locator(
        '[data-testid="application-card"]:has-text("submitted")',
      );
      if ((await submittedCard.count()) > 0) {
        submitted = true;
        break;
      }
      await page.waitForTimeout(3000);
    }
    expect(submitted, "expected application to reach submitted status").toBe(
      true,
    );
  });
});
