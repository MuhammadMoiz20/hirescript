import { test, expect } from "@playwright/test";

const SSE_BODY = [
  "event: chunk",
  "data: {\"text\":\"\\\\documentclass{article}\\\\begin{document}\"}",
  "",
  "event: chunk",
  "data: {\"text\":\"shorter resume\\\\end{document}\"}",
  "",
  "event: result",
  "data: {\"proposed_latex\":\"\\\\documentclass{article}\\\\begin{document}shorter resume\\\\end{document}\",\"page_count\":1,\"enforced\":true,\"iterations\":1,\"tier_history\":[\"haiku\"],\"removed_terms\":[]}",
  "",
  "",
].join("\n");

test("chat edit → diff → accept", async ({ page }) => {
  // Stub the streaming edit endpoint
  await page.route(/\/api\/resumes\/\d+\/edits$/, (route) => {
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: SSE_BODY,
    });
  });

  // Stub the accept endpoint
  await page.route(/\/api\/resumes\/\d+\/edits\/accept$/, (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Page-Count": "1" },
      body: JSON.stringify({
        id: 1,
        name: "EditTest",
        template_id: "jakes",
        kind: "master",
        latex_source:
          "\\documentclass{article}\\begin{document}shorter resume\\end{document}",
        updated_at: new Date().toISOString(),
      }),
    });
  });

  // Stub the compile endpoint to avoid Tectonic round-trip in this test
  await page.route(/\/api\/resumes\/\d+\/compile$/, (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-Page-Count": "1" },
      body: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
  });

  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.getByRole("button", { name: /new resume|get started/i }).first().click();
  await page.getByRole("button", { name: /start from scratch/i }).click();
  await page.getByLabel(/resume name/i).fill("EditTest");
  await page.getByRole("button", { name: /^create$/i }).click();

  // ChatSidebar textarea
  await page
    .getByRole("textbox", { name: /chat instruction/i })
    .fill("Tighten");
  await page.getByRole("button", { name: /send/i }).click();

  // DiffView shows up; page-count badge says "1 page"
  await expect(page.getByText(/1 page/i).first()).toBeVisible({ timeout: 15_000 });
  const acceptBtn = page.getByRole("button", { name: /^accept$/i });
  await expect(acceptBtn).toBeEnabled();
  await acceptBtn.click();

  // After accept, diff disappears — Accept button should no longer be present
  await expect(page.getByRole("button", { name: /^accept$/i })).toHaveCount(0, {
    timeout: 10_000,
  });
});
