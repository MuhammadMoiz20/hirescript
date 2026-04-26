import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// LIVE smoke test: profile persistence -> KB sync (latex_master + markdown)
// -> onboarding chat with a real Anthropic streamed reply.
//
// Anthropic and Voyage are real here — gate the whole spec behind LIVE_E2E so
// default CI doesn't burn credits. The dev stack (web + api + db) must be up
// and ANTHROPIC_API_KEY / VOYAGE_API_KEY configured in the api container for
// this to pass.

test.describe("onboarding + kb smoke", () => {
  test.skip(!process.env.LIVE_E2E, "LIVE_E2E env var not set");

  test("end-to-end: login → profile → kb sync → markdown → onboarding chat", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in ────────────────────────────────────────────────────────────
    await page.goto("http://localhost:5173");
    await page.getByLabel(/password/i).fill("changeme");
    await page.getByRole("button", { name: /log in/i }).click();
    // Wait until the main nav (Resumes button) is visible.
    await expect(
      page.getByRole("button", { name: /^Resumes$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Ensure a master resume exists for the latex_master KB source. If the
    // empty state shows "New resume", run through the scratch onboarding to
    // create one. Otherwise skip — a master is already present.
    const newResume = page.getByRole("button", {
      name: /new resume|get started/i,
    });
    if ((await newResume.count()) > 0) {
      await newResume.first().click();
      await page.getByRole("button", { name: /start from scratch/i }).click();
      await page.getByLabel(/resume name/i).fill("KB Smoke Master");
      await page.getByRole("button", { name: /^create$/i }).click();
      // Wait until the editor is ready before navigating away.
      await expect(
        page.getByRole("button", { name: /^compile$/i }),
      ).toBeVisible({ timeout: 15_000 });
    }

    // ── 2. Profile: fill, save, reload, assert persisted ─────────────────────
    await page.getByRole("button", { name: /^Profile$/ }).click();
    await expect(page.getByLabel(/^Legal name$/)).toBeVisible({
      timeout: 10_000,
    });
    await page.getByLabel(/^Legal name$/).fill("Smoke Test");
    await page.getByLabel(/^Email$/).fill("smoke@example.com");
    await page.getByRole("button", { name: /^Save$/ }).first().click();
    await expect(page.getByRole("status")).toHaveText(/Saved/i, {
      timeout: 10_000,
    });

    await page.reload();
    await expect(page.getByLabel(/^Legal name$/)).toHaveValue("Smoke Test", {
      timeout: 10_000,
    });
    await expect(page.getByLabel(/^Email$/)).toHaveValue("smoke@example.com");

    // ── 3. Knowledge: sync master LaTeX, assert chunk count > 0 ─────────────
    await page.getByRole("button", { name: /^Knowledge$/ }).click();
    await expect(
      page.getByRole("heading", { name: /Master LaTeX/i }),
    ).toBeVisible({ timeout: 10_000 });

    const masterCard = page
      .getByRole("heading", { name: /Master LaTeX/i })
      .locator("xpath=ancestor::*[self::div][1]");
    await masterCard.getByRole("button", { name: /Sync now/i }).click();
    // Wait for the "Syncing…" state to clear.
    await expect(
      masterCard.getByRole("button", { name: /Sync now/i }),
    ).toBeEnabled({ timeout: 60_000 });
    // Chunks count should now be > 0. The card renders "<n> chunks" with the
    // number bolded. Read the whole card text and parse.
    const masterText = await masterCard.innerText();
    const chunkMatch = masterText.match(/(\d+)\s+chunks/);
    expect(chunkMatch).not.toBeNull();
    expect(Number(chunkMatch![1])).toBeGreaterThan(0);

    // ── 4. Markdown: drop a fixture .md, sync, assert it appears ────────────
    const repoRoot = path.resolve(__dirname, "..", "..");
    const kbDir = path.join(repoRoot, "kb");
    const fixtureFile = path.join(kbDir, "smoke-fixture.md");
    fs.mkdirSync(kbDir, { recursive: true });
    fs.writeFileSync(
      fixtureFile,
      "# Smoke Fixture\n\nA test note for the markdown KB adapter.\n",
    );

    try {
      const mdCard = page
        .getByRole("heading", { name: /Manual Markdown/i })
        .locator("xpath=ancestor::*[self::div][1]");
      await mdCard.getByRole("button", { name: /Sync now/i }).click();
      await expect(
        mdCard.getByRole("button", { name: /Sync now/i }),
      ).toBeEnabled({ timeout: 60_000 });

      // Filter the documents table to markdown only and assert the fixture
      // title shows up.
      await page
        .getByLabel(/Filter by source/i)
        .selectOption("markdown");
      await expect(page.getByText(/Smoke Fixture/)).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      try {
        fs.unlinkSync(fixtureFile);
      } catch {
        // best effort
      }
    }

    // ── 5. Onboarding: send a message, assert a streamed reply renders ──────
    await page.getByRole("button", { name: /^Onboarding$/ }).click();
    await expect(page.getByLabel(/^Message$/)).toBeVisible({ timeout: 10_000 });
    await page
      .getByLabel(/^Message$/)
      .fill("Hi, my name is Smoke Test. Please reply with a short hello.");
    await page.getByRole("button", { name: /^Send$/ }).click();

    // The assistant turn renders with data-role="assistant"; wait for non-empty
    // text content (i.e. real streamed output, not the "…" placeholder).
    const assistant = page.locator("[data-role='assistant']").last();
    await expect
      .poll(
        async () => {
          const txt = (await assistant.innerText()).replace(/^agent\s*/i, "").trim();
          // Strip the placeholder ellipsis.
          return txt.replace(/^…$/, "").length;
        },
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
  });
});
