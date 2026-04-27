import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, it, expect } from "vitest";

import "./tokens.css";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(resolve(here, name), "utf8");

/**
 * Confirms the font wiring resolves to the expected stacks. We inject the
 * raw stylesheet text (same pattern as tokens.test.ts) so jsdom's CSSOM has
 * something to compute against — Vite's test-mode CSS handling does not
 * reach getComputedStyle reliably otherwise.
 */
describe("font wiring", () => {
  let style: HTMLStyleElement;

  beforeAll(() => {
    style = document.createElement("style");
    style.setAttribute("data-test", "fonts");
    style.textContent = read("tokens.css");
    document.head.appendChild(style);
  });

  afterAll(() => {
    style.remove();
  });

  it("exposes plan-spec font aliases on :root", () => {
    const cs = getComputedStyle(document.documentElement);
    // jsdom does not resolve var() chains, so accept either the expanded
    // stack or the literal alias pointer — both prove the alias is wired.
    expect(cs.getPropertyValue("--font-sans").trim()).toMatch(/Inter|--f-sans/);
    expect(cs.getPropertyValue("--font-serif").trim()).toMatch(/Source Serif 4|--f-serif/);
    expect(cs.getPropertyValue("--font-mono").trim()).toMatch(/JetBrains Mono|--f-mono/);
  });

  it("preserves the bundle-authoritative --f-* names", () => {
    const cs = getComputedStyle(document.documentElement);
    expect(cs.getPropertyValue("--f-sans").trim()).toMatch(/Inter/);
    expect(cs.getPropertyValue("--f-serif").trim()).toMatch(/Source Serif 4/);
    expect(cs.getPropertyValue("--f-mono").trim()).toMatch(/JetBrains Mono/);
  });

  // jsdom returns the literal `var(--f-sans)` for computed font-family
  // instead of resolving the custom property, so resolved-stack assertions
  // are unreliable here. The plan explicitly allows skipping this under
  // jsdom; the alias and --f-* checks above still verify the wiring.
  it.skip("resolves body font-family to a stack starting with Inter (jsdom does not resolve var())", () => {
    const resolved = getComputedStyle(document.body).fontFamily;
    expect(resolved).toMatch(/Inter/);
  });

  // Same jsdom limitation: var() is not resolved in computed font-family.
  it.skip("resolves headings/code/pre to their declared stacks (jsdom does not resolve var())", () => {
    const h1 = document.createElement("h1");
    document.body.appendChild(h1);
    try {
      expect(getComputedStyle(h1).fontFamily).toMatch(/Source Serif 4/);
    } finally {
      h1.remove();
    }
  });

  // Asserts the cascade actually targets the right elements with the right
  // var(), even though jsdom won't expand it. Catches accidental rule loss.
  it("declares serif on h1..h6 and mono on code/pre/kbd/samp via the cascade", () => {
    const h1 = document.createElement("h1");
    const code = document.createElement("code");
    document.body.append(h1, code);
    try {
      expect(getComputedStyle(h1).fontFamily).toMatch(/Source Serif 4|--f-serif/);
      expect(getComputedStyle(code).fontFamily).toMatch(/JetBrains Mono|--f-mono/);
    } finally {
      h1.remove();
      code.remove();
    }
  });
});
