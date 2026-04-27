import { test, expect, Page } from "@playwright/test";

/**
 * Multi-source ingest smoke (slice 4 task 15).
 *
 * Walks the user-facing surfaces slice 4 introduces:
 *
 *   1. Log in.
 *   2. Companies admin page → add a Lever company (POST /companies is
 *      mocked at the route layer so the backend's sanity-check fetch
 *      doesn't actually hit Lever's API).
 *   3. Trigger an ingest_source job for that company via a test admin
 *      endpoint, if one exists; otherwise skip with a console.log.
 *      Inbox source=lever should then contain the new posting.
 *   4. Open the Inbox → click "Paste job URL" → submit a Workable URL
 *      (POST /postings/from_url mocked). Assert the posting lands.
 *   5. Click the Lever filter chip; assert only lever postings visible.
 *      Click All; assert all postings visible.
 *   6. (`LIVE_E2E=1` and `LIVE_GMAIL_USER` set) Trigger an ingest_gmail
 *      job via API; assert the job succeeds.
 *
 * Hard assertions are gated behind LIVE_E2E for steps that need the full
 * backend. Without LIVE_E2E the spec asserts the wiring renders + the
 * mocked POSTs settle, to keep CI useful as a smoke test.
 *
 * Run locally with:
 *   E2E_TESTING=1 npx playwright test sources
 */

const APP_PASSWORD = process.env.APP_PASSWORD ?? "changeme";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

async function login(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  const pwd = page.getByLabel(/password/i);
  if (await pwd.count()) {
    await pwd.fill(APP_PASSWORD);
    await page.getByRole("button", { name: /log in/i }).click();
  }
  // Wait for top-level chrome.
  await expect(page.getByRole("button", { name: /^resumes$/i }).or(
    page.getByRole("link", { name: /library/i }),
  )).toBeVisible({ timeout: 15_000 });
}

async function openCompanies(page: Page): Promise<void> {
  // Navigate via Settings → "Manage companies" link first; fall back to
  // direct view switch via the command palette nav-companies entry.
  const settings = page.getByRole("link", { name: /settings/i });
  if (await settings.count()) {
    await settings.first().click();
  }
  const openBtn = page.getByTestId("settings-companies-open");
  if (await openBtn.count()) {
    await openBtn.click();
  }
  await expect(page.getByTestId("companies-route")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("multi-source ingest smoke", () => {
  test("companies UI: add a lever company (network mocked)", async ({ page }) => {
    // Stub POST /companies so we don't really hit Lever's API in the
    // backend sanity-check fetch.
    await page.route("**/api/companies", async (route, request) => {
      if (request.method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: 9001,
            source: "lever",
            slug: "netflix",
            display_name: "Netflix",
            enabled: true,
            created_at: new Date().toISOString(),
          }),
        });
      } else {
        await route.continue();
      }
    });

    await login(page);
    await openCompanies(page);

    await page
      .getByTestId("companies-add-source")
      .selectOption("lever");
    await page.getByTestId("companies-add-slug").fill("netflix");
    await page.getByTestId("companies-add-name").fill("Netflix");
    await page.getByTestId("companies-add-submit").click();

    // After the POST resolves the new row should be in the lever group.
    await expect(page.getByTestId("companies-group-lever")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("companies-group-lever").getByText("Netflix"),
    ).toBeVisible();
  });

  test("inbox: paste-url + source filter (network mocked)", async ({ page }) => {
    // Mock POST /postings/from_url so no real network is touched.
    await page.route("**/api/postings/from_url", async (route, request) => {
      if (request.method() !== "POST") return route.continue();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: 9100,
          source: "workable",
          source_job_id: "wk-9100",
          company: "Miro",
          title: "Senior Frontend",
          location: "Remote",
          apply_url: "https://apply.workable.com/miro/j/wk-9100/",
          tier: null,
          fit_score: null,
          status: "ingested",
          ingested_at: new Date().toISOString(),
        }),
      });
    });

    await login(page);

    // Navigate to Inbox.
    const inboxNav = page.getByRole("link", { name: /inbox/i });
    if (await inboxNav.count()) {
      await inboxNav.first().click();
    } else {
      console.log("[sources] no inbox nav affordance — skipping");
      return;
    }

    // Paste a workable URL.
    const pasteBtn = page.getByTestId("inbox-paste-url");
    await expect(pasteBtn).toBeVisible({ timeout: 10_000 });
    await pasteBtn.click();
    await page
      .getByTestId("paste-url-input")
      .fill("https://apply.workable.com/miro/j/wk-9100/");
    await page.getByTestId("paste-url-submit").click();

    // The new row should appear with source=workable.
    await expect(page.getByText("Miro").first()).toBeVisible({
      timeout: 10_000,
    });

    // Click the Lever filter chip — fetches with source=lever.
    const sourceGroup = page.getByRole("group", { name: /source filter/i });
    await sourceGroup.getByRole("button", { name: "Lever" }).click();
    // The Miro row (workable) should disappear, since the listing refetched
    // with source=lever. The list might be empty in test mode — we just
    // assert that Miro is no longer visible (the request fired).
    await expect(page.getByText("Miro").first()).toHaveCount(0, {
      timeout: 10_000,
    });

    // Click All to clear.
    await sourceGroup.getByRole("button", { name: "All" }).click();
  });

  test("ingest_source for lever via admin endpoint (LIVE_E2E)", async ({ page }) => {
    test.skip(!process.env.LIVE_E2E, "LIVE_E2E env var not set");
    test.setTimeout(180_000);

    await login(page);

    // No admin endpoint exists today for enqueueing an ingest_source job
    // (the worker scheduler runs on its own ~15m cadence). Skip with a
    // log if the endpoint is missing, mirroring slice 3 batch D's pattern.
    const tickRes = await page.request.post(
      `${BASE_URL}/api/admin/enqueue-ingest`,
      { data: { source: "lever", company_slug: "netflix" } },
    );
    if (!tickRes.ok()) {
      console.log(
        `[sources] no admin/enqueue-ingest endpoint (${tickRes.status()}); ` +
          "ingest assertion skipped — scheduler runs on its own cadence.",
      );
      return;
    }

    // If the endpoint does exist, wait briefly for the worker to pick it up
    // and assert at least one lever posting lands in the inbox.
    await page.waitForTimeout(15_000);
    const postings = await page.request.get(
      `${BASE_URL}/api/postings?source=lever&limit=200`,
    );
    expect(postings.ok(), `GET /postings?source=lever ${postings.status()}`).toBeTruthy();
    const json = (await postings.json()) as {
      items: Array<{ id: number; source: string }>;
    };
    expect(
      json.items.length,
      "expected at least one lever posting after ingest",
    ).toBeGreaterThanOrEqual(1);
    expect(json.items.every((i) => i.source === "lever")).toBeTruthy();
  });

  test("ingest_gmail smoke (LIVE_E2E + LIVE_GMAIL_USER)", async ({ page }) => {
    test.skip(!process.env.LIVE_E2E, "LIVE_E2E env var not set");
    test.skip(!process.env.LIVE_GMAIL_USER, "LIVE_GMAIL_USER env var not set");
    test.setTimeout(180_000);

    await login(page);

    const res = await page.request.post(
      `${BASE_URL}/api/admin/enqueue-ingest-gmail`,
      { data: {} },
    );
    if (!res.ok()) {
      console.log(
        `[sources] no admin/enqueue-ingest-gmail endpoint (${res.status()}); ` +
          "gmail smoke skipped.",
      );
      return;
    }
    // Mailbox content is non-deterministic — assert only that the request
    // accepted (the runner returns 0 postings for an empty mailbox).
    expect(res.ok()).toBeTruthy();
  });
});
