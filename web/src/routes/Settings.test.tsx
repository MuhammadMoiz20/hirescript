/**
 * Settings route tests — section rendering, typed-confirm danger zone,
 * client-only API key persistence, and profile JSON export download.
 */
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Settings from "./Settings";
import { api } from "../api";

const API_KEY_STORAGE = "hs-anthropic-api-key";

describe("Settings route", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test("renders all top-level sections", () => {
    render(<Settings />);
    expect(screen.getByTestId("settings-route")).toBeInTheDocument();
    expect(screen.getByTestId("settings-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("settings-apikey")).toBeInTheDocument();
    expect(screen.getByTestId("settings-models")).toBeInTheDocument();
    expect(screen.getByTestId("settings-exports")).toBeInTheDocument();
    expect(screen.getByTestId("settings-danger")).toBeInTheDocument();
  });

  test("workspace shows browser-derived timezone + locale (read-only)", () => {
    render(<Settings />);
    const tz = screen.getByTestId("settings-timezone");
    const loc = screen.getByTestId("settings-locale");
    expect(tz.textContent?.length).toBeGreaterThan(0);
    expect(loc.textContent?.length).toBeGreaterThan(0);
    // No editable inputs in workspace.
    const ws = screen.getByTestId("settings-workspace");
    expect(within(ws).queryByRole("textbox")).not.toBeInTheDocument();
  });

  test("API key persists to localStorage only — no fetch on save", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<Settings />);
    const input = screen.getByTestId("settings-apikey-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-ant-test" } });
    fireEvent.click(screen.getByTestId("settings-apikey-save"));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBe("sk-ant-test");
    expect(screen.getByTestId("settings-apikey-saved")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("API key clear removes value from localStorage", () => {
    localStorage.setItem(API_KEY_STORAGE, "sk-ant-existing");
    render(<Settings />);
    fireEvent.click(screen.getByTestId("settings-apikey-clear"));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull();
  });

  test("Max subscription connect button is disabled (Slice 3 placeholder)", () => {
    render(<Settings />);
    expect(screen.getByTestId("settings-max-connect")).toBeDisabled();
  });

  test("model defaults render the canonical per-stage models", () => {
    render(<Settings />);
    expect(screen.getByTestId("settings-model-classify")).toBeInTheDocument();
    expect(screen.getByTestId("settings-model-jd-parser")).toBeInTheDocument();
    expect(screen.getByTestId("settings-model-tailor")).toBeInTheDocument();
    expect(screen.getByTestId("settings-model-cover-letter")).toBeInTheDocument();
  });

  test("exports: profile download triggers Blob URL + anchor click", async () => {
    const profileMock = vi
      .spyOn(api, "getProfile")
      .mockResolvedValue({ projects: [], experience: [] } as unknown as Awaited<
        ReturnType<typeof api.getProfile>
      >);
    const createUrl = vi.fn(() => "blob:mock");
    const revokeUrl = vi.fn();
    // jsdom doesn't implement URL.createObjectURL — install spies.
    Object.defineProperty(URL, "createObjectURL", { value: createUrl, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeUrl, configurable: true });
    // jsdom emits "navigation not implemented" when anchor.click() fires; stub it.
    const clickStub = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<Settings />);
    fireEvent.click(screen.getByTestId("settings-export-profile"));

    await waitFor(() => {
      expect(profileMock).toHaveBeenCalled();
      expect(createUrl).toHaveBeenCalled();
      expect(screen.getByTestId("settings-export-profile-done")).toBeInTheDocument();
    });
    expect(revokeUrl).toHaveBeenCalled();
    expect(clickStub).toHaveBeenCalled();
  });

  test("exports: failed profile fetch surfaces an error message", async () => {
    vi.spyOn(api, "getProfile").mockRejectedValue({ status: 500, detail: "boom" });
    render(<Settings />);
    fireEvent.click(screen.getByTestId("settings-export-profile"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-export-profile-error")).toHaveTextContent(/boom/);
    });
  });

  test("exports: resumes ZIP and CSV are disabled with Slice 3 note", () => {
    render(<Settings />);
    expect(screen.getByTestId("settings-export-resumes")).toBeDisabled();
    expect(screen.getByTestId("settings-export-csv")).toBeDisabled();
  });

  test("danger zone: KB delete is disabled (no bulk endpoint in Slice 2)", () => {
    render(<Settings />);
    const action = screen.getByTestId("danger-kb-action");
    const input = screen.getByTestId("danger-kb-input") as HTMLInputElement;
    expect(action).toBeDisabled();
    expect(input).toBeDisabled();
    // Even typing the magic word doesn't enable it (no onConfirm).
    expect(action).toBeDisabled();
  });

  test("danger zone: wipe button stays disabled until exact confirm word typed", () => {
    localStorage.setItem("hs-theme", "dark");
    localStorage.setItem(API_KEY_STORAGE, "sk-ant-x");
    render(<Settings />);

    const action = screen.getByTestId("danger-wipe-action");
    const input = screen.getByTestId("danger-wipe-input") as HTMLInputElement;

    expect(action).toBeDisabled();

    // Wrong word — still disabled.
    fireEvent.change(input, { target: { value: "wipe" } });
    expect(action).toBeDisabled();

    // Correct word — enables.
    fireEvent.change(input, { target: { value: "WIPE" } });
    expect(action).not.toBeDisabled();

    fireEvent.click(action);
    expect(localStorage.getItem("hs-theme")).toBeNull();
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull();
    expect(screen.getByTestId("danger-wipe-done")).toBeInTheDocument();
  });
});
