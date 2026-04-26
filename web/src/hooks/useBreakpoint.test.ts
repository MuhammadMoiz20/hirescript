import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBreakpoint } from "./useBreakpoint";

function mockMatchMedia(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const m = query.match(/min-width:\s*(\d+)px/);
    const min = m ? Number(m[1]) : 0;
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    } as MediaQueryList;
  });
}

describe("useBreakpoint", () => {
  beforeEach(() => {
    mockMatchMedia(1400);
  });

  it("returns 'desktop' at >=1200px", () => {
    mockMatchMedia(1400);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
  });

  it("returns 'tablet' between 768 and 1199", () => {
    mockMatchMedia(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("tablet");
  });

  it("returns 'mobile' below 768", () => {
    mockMatchMedia(500);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("mobile");
  });
});
