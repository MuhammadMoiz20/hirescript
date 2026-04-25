import { test, expect } from "@playwright/test";

test("create → compile → preview", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  // Open onboarding (New resume) — works in both empty and populated states.
  await page.getByRole("button", { name: /new resume|get started/i }).first().click();
  await page.getByRole("button", { name: /start from scratch/i }).click();
  await page.getByLabel(/resume name/i).fill("Smoke");
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.getByRole("button", { name: /^compile$/i }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
});
