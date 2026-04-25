import "@testing-library/jest-dom";

// Polyfill localStorage for jsdom if missing or broken.
function makeStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    clear() { store = {}; },
    getItem(k: string) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    key(i: number) { return Object.keys(store)[i] ?? null; },
    removeItem(k: string) { delete store[k]; },
    setItem(k: string, v: string) { store[k] = String(v); },
  };
}

if (typeof window !== "undefined") {
  if (!window.localStorage || typeof window.localStorage.setItem !== "function") {
    Object.defineProperty(window, "localStorage", { value: makeStorage(), configurable: true });
  }
  if (!window.sessionStorage || typeof window.sessionStorage.setItem !== "function") {
    Object.defineProperty(window, "sessionStorage", { value: makeStorage(), configurable: true });
  }
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
}
