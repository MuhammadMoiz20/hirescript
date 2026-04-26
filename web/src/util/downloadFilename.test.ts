import { describe, expect, test } from "vitest";
import { downloadFilename } from "./downloadFilename";

describe("downloadFilename", () => {
  test("uses company portion of variant name (em-dash separator)", () => {
    expect(downloadFilename("Smoke \u2014 Loop")).toBe("Muhammad_Moiz_Loop.pdf");
  });

  test("uses company portion when separated by ASCII dash with spaces", () => {
    expect(downloadFilename("Smoke - Acme Corp")).toBe("Muhammad_Moiz_Acme_Corp.pdf");
  });

  test("falls back to full name for masters", () => {
    expect(downloadFilename("Smoke")).toBe("Muhammad_Moiz_Smoke.pdf");
  });

  test("strips unsafe characters and collapses whitespace", () => {
    expect(downloadFilename("Smoke \u2014 J&J / Health!")).toBe("Muhammad_Moiz_JJ_Health.pdf");
  });

  test("uses 'Resume' fallback for empty input", () => {
    expect(downloadFilename("")).toBe("Muhammad_Moiz_Resume.pdf");
  });

  test("respects custom owner override", () => {
    expect(downloadFilename("Smoke \u2014 Loop", "Jane_Doe")).toBe("Jane_Doe_Loop.pdf");
  });
});
