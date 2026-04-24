import { test, expect } from "@playwright/test";

test("create → compile → preview", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.getByPlaceholder(/new resume name/i).fill("Smoke");
  await page.getByRole("button", { name: /create/i }).click();
  await page.getByRole("button", { name: "Smoke" }).click();
  await page.getByRole("button", { name: /compile/i }).click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
});
