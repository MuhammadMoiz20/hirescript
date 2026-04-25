import { test, expect } from "@playwright/test";

test("overflow banner triggers tighten flow", async ({ page }) => {
  const masterId = 77;
  const resumeOut = (over: any = {}) => ({
    id: masterId, name: "OBig", template_id: "jakes", kind: "master",
    latex_source: "\\documentclass{article}\\begin{document}big\\end{document}",
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
    content_json: { header: { name: "Z", tagline: "", contacts: [] }, education: [], experience: [], projects: [], skills: {} },
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
    headers: { "X-Page-Count": "2" },
    body: Buffer.from("%PDF-1.4\n%%EOF\n"),
  }));

  // streamEdit SSE: deliver a result with enforced=true 1-page proposal
  await page.route(new RegExp(`/api/resumes/${masterId}/edits$`), route => {
    const body = [
      "event: chunk", "data: {\"text\":\"\\\\documentclass{article}\\\\begin{document}\"}", "",
      "event: chunk", "data: {\"text\":\"shorter\\\\end{document}\"}", "",
      "event: result",
      "data: " + JSON.stringify({
        proposed_latex: "\\documentclass{article}\\begin{document}shorter\\end{document}",
        page_count: 1, enforced: true, iterations: 1,
        tier_history: ["haiku"], removed_terms: [],
      }),
      "", "",
    ].join("\n");
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body,
    });
  });

  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.getByRole("button", { name: /open editor/i }).first().click();
  // Force a compile so pageCount is known
  await page.getByRole("button", { name: /^compile$/i }).click();
  // Banner appears
  await expect(page.getByRole("alert").filter({ hasText: /2 page/ })).toBeVisible({ timeout: 10_000 });
  // Click tighten
  await page.getByRole("button", { name: /ask claude to tighten/i }).click();
  // DiffView shows up with the 1-page badge
  await expect(page.getByText(/1 page/i).first()).toBeVisible({ timeout: 10_000 });
  // The Accept button is enabled because enforced=true
  const accept = page.getByRole("button", { name: /^accept$/i });
  await expect(accept).toBeEnabled();
});
