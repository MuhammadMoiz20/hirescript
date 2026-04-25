import { test, expect } from "@playwright/test";

test("history view lists versions and rollback hits API", async ({ page }) => {
  let rollbackHit = 0;

  const masterId = 42;
  const resumeOut = (over: any = {}) => ({
    id: masterId, name: "VHist", template_id: "jakes", kind: "master",
    latex_source: "\\documentclass{article}\\begin{document}x\\end{document}",
    updated_at: new Date().toISOString(),
    ...over,
  });
  const sectionsPayload = {
    template_id: "jakes",
    schema: {
      sections: [
        { id: "header", type: "header" },
        { id: "education", type: "list_subheading", title: "Education" },
        { id: "experience", type: "list_subheading", title: "Experience" },
        { id: "projects", type: "list_project", title: "Projects" },
        { id: "skills", type: "key_value_list", title: "Technical Skills" },
      ],
      subheading_fields: { institution: "Institution", location: "Location", degree: "Title / Degree", date: "Date" },
      project_fields: { name: "Name", tech: "Tech", date: "Date" },
    },
    content_json: { header: { name: "Y", tagline: "", contacts: [] }, education: [], experience: [], projects: [], skills: {} },
  };

  await page.route(/\/api\/resumes\/grouped$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ master: resumeOut(), variants: [] }]),
  }));
  await page.route(new RegExp(`/api/resumes/${masterId}$`), route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(resumeOut()),
  }));
  await page.route(new RegExp(`/api/resumes/${masterId}/sections$`), route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(sectionsPayload),
  }));
  await page.route(new RegExp(`/api/resumes/${masterId}/compile$`), route => route.fulfill({
    status: 200, contentType: "application/pdf",
    headers: { "X-Page-Count": "1" },
    body: Buffer.from("%PDF-1.4\n%%EOF\n"),
  }));
  await page.route(new RegExp(`/api/resumes/${masterId}/versions$`), route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([
      { id: 7, edit_source: "manual",  edit_prompt: null,           page_count: 1, created_at: "2026-04-29T10:00:00Z" },
      { id: 8, edit_source: "ai_chat", edit_prompt: "tighten exp",  page_count: 1, created_at: "2026-04-29T11:00:00Z" },
    ]),
  }));
  await page.route(new RegExp(`/api/resumes/${masterId}/versions/7/rollback$`), route => {
    rollbackHit++;
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(resumeOut({ latex_source: "rolled-back-source" })),
    });
  });

  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  // Click into the master
  await page.getByRole("button", { name: /open editor/i }).first().click();
  // Click "History" pill in Editor
  await page.getByRole("button", { name: /^history$/i }).click();
  // Versions list
  await expect(page.getByText("manual")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("ai_chat")).toBeVisible();
  await expect(page.getByText("tighten exp")).toBeVisible();
  // Rollback v7
  await page.getByRole("button", { name: /rollback to v7/i }).click();
  await expect.poll(() => rollbackHit, { timeout: 5_000 }).toBeGreaterThan(0);
});
