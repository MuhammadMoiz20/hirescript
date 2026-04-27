import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, it, expect } from "vitest";

// Side-effect imports mirror what main.tsx does. Vitest/Vite handles them
// for the runtime bundle; we additionally inject the raw text below so
// jsdom's CSSOM (which does parse the rules but isn't reached by Vite's
// dev-mode HMR style injection in the test harness) can answer
// getComputedStyle queries.
import "./tokens.css";
import "./tokens-massapply.css";
import "./suite.css";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, name), "utf8");

/**
 * Smoke test: confirm the entry CSS files actually land in the document
 * and define the variables downstream surfaces depend on.
 */
describe("design tokens", () => {
  let style: HTMLStyleElement;

  beforeAll(() => {
    style = document.createElement("style");
    style.setAttribute("data-test", "tokens");
    style.textContent = [
      read("tokens.css"),
      read("tokens-massapply.css"),
      read("suite.css"),
    ].join("\n");
    document.head.appendChild(style);
  });

  afterAll(() => {
    style.remove();
  });

  const root = () => document.documentElement;

  it("exposes a base ink token from tokens.css", () => {
    const value = getComputedStyle(root()).getPropertyValue("--ink").trim();
    expect(value).not.toBe("");
  });

  it("exposes the dream tier token from tokens-massapply.css", () => {
    const value = getComputedStyle(root()).getPropertyValue("--tier-dream").trim();
    expect(value).not.toBe("");
  });

  it("exposes a suite-level layout primitive from suite.css", () => {
    const el = document.createElement("div");
    el.className = "suite-shell";
    document.body.appendChild(el);
    try {
      expect(getComputedStyle(el).display).toBe("grid");
    } finally {
      el.remove();
    }
  });
});
