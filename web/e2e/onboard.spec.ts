import { test, expect } from "@playwright/test";

test("paste LaTeX onboarding creates master", async ({ page }) => {
  let groupedCalls = 0;

  await page.route(/\/api\/resumes\/grouped$/, route => {
    groupedCalls++;
    if (groupedCalls === 1) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify([]),
      });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{
        master: { id: 99, name: "ImportTex", template_id: "jakes", kind: "master", latex_source: "", updated_at: new Date().toISOString() },
        variants: [],
      }]),
    });
  });

  await page.route(/\/api\/resumes\/onboard\/tex$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      id: 99, name: "ImportTex", template_id: "jakes", kind: "master",
      latex_source: "\\documentclass{article}\\begin{document}imported\\end{document}",
      updated_at: new Date().toISOString(),
      enforced: true, iterations: 0, page_count: 1,
    }),
  }));

  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  // Empty state: click New resume to enter onboarding
  await page.getByRole("button", { name: /new resume/i }).first().click();
  // Choose Paste LaTeX mode card
  await page.getByRole("button", { name: /paste latex/i }).click();
  await expect(page.getByRole("form", { name: /new resume/i })).toBeVisible();
  await page.getByLabel(/resume name/i).fill("ImportTex");
  await page.getByLabel(/latex source/i).fill("\\documentclass{article}\\begin{document}imported\\end{document}");
  await page.getByRole("button", { name: /^create$/i }).click();
  // After success, the editor opens for the new master
  await expect(page.getByRole("button", { name: /^compile$/i })).toBeVisible({ timeout: 10_000 });
});
