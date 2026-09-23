// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

const { applyAccent } = await import("./settings");

beforeEach(() => {
  document.documentElement.removeAttribute("style");
});

/**
 * The panel's own colour (owner's request, 23 Sep 2026 — a deliberate exception
 * to brief 7.1's neutral chrome).
 */
describe("the panel's colour", () => {
  it("is the palette's own pairing, so the ink on it is already contrast-checked", () => {
    applyAccent("teal");
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--accent-bg")).toBe("var(--note-teal-bg)");
    expect(root.getPropertyValue("--accent-ink")).toBe("var(--note-teal-text)");
  });

  it("leaves nothing behind when there is no colour", () => {
    applyAccent("blue");
    applyAccent("none");
    const root = document.documentElement.style;
    // Removed rather than set to a neutral, so every rule falls back to what it
    // said before there was a colour at all.
    expect(root.getPropertyValue("--accent-bg")).toBe("");
    expect(root.getPropertyValue("--accent-ink")).toBe("");
  });
});
