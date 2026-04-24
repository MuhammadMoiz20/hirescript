import { test, expect } from "@playwright/test";

test("section form editor: edit header name and save", async ({ page }) => {
  // Resume payload
  const resumeOut = (over: any = {}) => ({
    id: 1, name: "Sec", template_id: "jakes", kind: "master",
    latex_source: "\\documentclass{article}\\begin{document}x\\end{document}",
    updated_at: new Date().toISOString(),
    ...over,
  });

  const sectionsPayload = (name = "Initial") => ({
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
    content_json: {
      header: { name, tagline: "Eng", contacts: [] },
      education: [], experience: [], projects: [], skills: {},
    },
  });

  let putSectionsBody: any = null;

  await page.route(/\/api\/resumes\/grouped$/, route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{
      master: resumeOut(),
      variants: [],
    }]),
  }));

  await page.route(/\/api\/resumes\/1$/, route => {
    if (route.request().method() === "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resumeOut()) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resumeOut()) });
  });

  await page.route(/\/api\/resumes\/1\/sections$/, route => {
    if (route.request().method() === "PUT") {
      try { putSectionsBody = JSON.parse(route.request().postData() || "{}"); } catch {}
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resumeOut({ latex_source: "\\documentclass{article}\\begin{document}saved\\end{document}" })) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sectionsPayload()) });
  });

  await page.route(/\/api\/resumes\/1\/compile$/, route => route.fulfill({
    status: 200, contentType: "application/pdf",
    headers: { "X-Page-Count": "1" },
    body: Buffer.from("%PDF-1.4\n%%EOF\n"),
  }));

  await page.goto("http://localhost:5173");
  await page.getByLabel(/password/i).fill("changeme");
  await page.getByRole("button", { name: /log in/i }).click();
  // Open the master
  await page.getByRole("button", { name: "Sec" }).click();

  // Form view default — header Name input visible with the initial value
  const nameInput = page.getByLabel("Name", { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await expect(nameInput).toHaveValue("Initial");

  // Edit the name
  await nameInput.fill("Edited");
  // Save
  await page.getByRole("button", { name: /^save$/i }).last().click();

  // PUT /sections request body should reflect the edit
  await expect.poll(() => putSectionsBody?.content_json?.header?.name, { timeout: 10_000 }).toBe("Edited");
});
