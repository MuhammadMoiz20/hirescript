import { test, expect } from "@playwright/test";

test("tailor flow creates a variant", async ({ page }) => {
  let groupedCalls = 0;

  // Initial grouped: master only. Subsequent: master + variant.
  await page.route(/\/api\/resumes\/grouped$/, route => {
    groupedCalls++;
    if (groupedCalls === 1) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify([{
          master: { id: 1, name: "Mtest", template_id: "jakes", kind: "master", latex_source: "", updated_at: "" },
          variants: [],
        }]),
      });
    }
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{
        master: { id: 1, name: "Mtest", template_id: "jakes", kind: "master", latex_source: "", updated_at: "" },
        variants: [{
          id: 2, name: "Mtest — Acme", template_id: "jakes", kind: "variant",
          latex_source: "", updated_at: "", parent_id: 1, job_description_id: 9,
          jd_title: "SWE", jd_company: "Acme",
        }],
      }]),
    });
  });

  // Tailor stub
  await page.route(/\/api\/resumes\/1\/tailor$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      variant: { id: 2, name: "Mtest — Acme", template_id: "jakes", kind: "variant", latex_source: "", updated_at: new Date().toISOString() },
      jd_id: 9,
      page_count: 1,
      iterations: 1,
      enforced: true,
      tier_history: ["sonnet"],
      keywords_used: ["python", "fastapi"],
    }),
  }));

  await page.goto("http://localhost:5173");
  // login
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  // master visible
  await expect(page.getByRole("heading", { name: /^Mtest$/ })).toBeVisible();
  // open tailor modal
  await page.getByRole("button", { name: /tailor to jd/i }).click();
  await expect(page.getByRole("dialog", { name: /tailor to jd/i })).toBeVisible();
  // fill and submit
  await page.getByLabel("Title", { exact: true }).fill("SWE");
  await page.getByLabel("Company", { exact: true }).fill("Acme");
  await page.getByLabel(/job description/i).fill("JD body about python and fastapi");
  await page.getByRole("button", { name: "Tailor", exact: true }).click();
  // variant appears in list
  await expect(page.getByText(/SWE @ Acme/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Mtest — Acme/)).toBeVisible();
});
