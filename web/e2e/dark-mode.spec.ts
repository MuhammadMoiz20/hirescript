import { test, expect } from "@playwright/test";

test("library renders in dark mode", async ({ page }) => {
  // Set theme before navigation so first paint is dark
  await page.addInitScript(() => {
    window.localStorage.setItem("hs-theme", "dark");
  });
  // Stub auth/me and grouped so we don't need backend cleanliness
  await page.route(/\/api\/auth\/me$/, route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ user_id: 1 }),
  }));
  await page.route(/\/api\/resumes\/grouped$/, route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([]),
  }));

  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.goto("http://localhost:5173");
  await expect(page.locator("body")).toBeVisible();
  // Confirm html has dark theme attr applied
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(themeAttr).toBe("dark");
  expect(errors).toEqual([]);
});
