import { describe, expect, it } from "vitest";

import { FORMAT_SHORTCUTS, formatCommandForKey, shortcutLabel } from "./formatting";

function key(init: Partial<KeyboardEvent>) {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, code: "", ...init };
}

describe("formatCommandForKey", () => {
  it("maps the accelerator with either Cmd or Ctrl", () => {
    expect(formatCommandForKey(key({ metaKey: true, code: "KeyB" }))).toBe("bold");
    expect(formatCommandForKey(key({ ctrlKey: true, code: "KeyI" }))).toBe("italic");
    expect(formatCommandForKey(key({ metaKey: true, shiftKey: true, code: "KeyX" }))).toBe(
      "strike",
    );
    expect(formatCommandForKey(key({ metaKey: true, shiftKey: true, code: "Digit7" }))).toBe(
      "ordered",
    );
  });

  it("needs the exact modifiers", () => {
    expect(formatCommandForKey(key({ code: "KeyB" }))).toBeNull();
    expect(formatCommandForKey(key({ metaKey: true, shiftKey: true, code: "KeyB" }))).toBeNull();
    expect(formatCommandForKey(key({ metaKey: true, code: "KeyX" }))).toBeNull();
    expect(formatCommandForKey(key({ metaKey: true, altKey: true, code: "KeyB" }))).toBeNull();
  });

  it("does not claim the panel's own shortcuts", () => {
    for (const code of ["KeyF", "KeyN"]) {
      expect(formatCommandForKey(key({ metaKey: true, code }))).toBeNull();
    }
  });
});

describe("the table itself", () => {
  it("gives every command exactly one key, and no two the same", () => {
    const seen = new Set<string>();
    for (const shortcut of FORMAT_SHORTCUTS) {
      const key = `${shortcut.code}${shortcut.shift ? "+shift" : ""}`;
      expect(seen.has(key), `${key} is bound twice`).toBe(false);
      seen.add(key);
    }
    // Every command the toolbar can run is reachable from the keyboard.
    expect(FORMAT_SHORTCUTS.map((shortcut) => shortcut.command)).toEqual([
      "bold",
      "italic",
      "strike",
      "code",
      "bullet",
      "ordered",
      "task",
      "codeblock",
    ]);
  });
});

describe("shortcutLabel", () => {
  const strike = FORMAT_SHORTCUTS.find((shortcut) => shortcut.command === "strike");

  it("uses the platform's notation", () => {
    if (!strike) {
      throw new Error("strike shortcut missing");
    }
    expect(shortcutLabel(strike, true)).toBe("⌘⇧X");
    expect(shortcutLabel(strike, false)).toBe("Ctrl+Shift+X");
  });
});
