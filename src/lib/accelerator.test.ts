import { describe, expect, it } from "vitest";

import { acceleratorFromEvent, formatAccelerator, isMacPlatform } from "./accelerator";

function press(
  code: string,
  modifiers: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {},
) {
  return {
    code,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    metaKey: modifiers.meta ?? false,
  };
}

describe("acceleratorFromEvent", () => {
  it("builds an accelerator in the order the parser and macOS both use", () => {
    expect(acceleratorFromEvent(press("KeyN", { ctrl: true, alt: true, shift: true, meta: true })))
      .toBe("Ctrl+Alt+Shift+Cmd+KeyN");
  });

  it("keeps the key as a code, which is what global-hotkey parses", () => {
    expect(acceleratorFromEvent(press("Digit1", { meta: true }))).toBe("Cmd+Digit1");
    expect(acceleratorFromEvent(press("Space", { ctrl: true }))).toBe("Ctrl+Space");
    expect(acceleratorFromEvent(press("F5", { alt: true }))).toBe("Alt+F5");
  });

  it("refuses a bare key: a global shortcut takes it from every other app", () => {
    expect(acceleratorFromEvent(press("KeyN"))).toBeNull();
  });

  it("refuses Shift alone, which is not enough of a modifier either", () => {
    expect(acceleratorFromEvent(press("KeyN", { shift: true }))).toBeNull();
  });

  it("ignores a modifier pressed by itself, so recording waits for a real key", () => {
    expect(acceleratorFromEvent(press("MetaLeft", { meta: true }))).toBeNull();
    expect(acceleratorFromEvent(press("AltRight", { alt: true }))).toBeNull();
  });
});

describe("formatAccelerator", () => {
  it("draws macOS shortcuts as symbols, with no separators", () => {
    expect(formatAccelerator("Cmd+Alt+KeyN", true)).toBe("⌘⌥N");
    expect(formatAccelerator("Ctrl+Alt+Shift+Cmd+KeyN", true)).toBe("⌃⌥⇧⌘N");
  });

  it("spells modifiers out elsewhere", () => {
    expect(formatAccelerator("Ctrl+Alt+KeyN", false)).toBe("Ctrl + Alt + N");
  });

  it("reads the stored default, whichever platform it is shown on", () => {
    expect(formatAccelerator("CmdOrCtrl+Alt+N", true)).toBe("⌘⌥N");
    expect(formatAccelerator("CmdOrCtrl+Alt+N", false)).toBe("Ctrl + Alt + N");
  });

  it("labels keys that read badly as a code", () => {
    expect(formatAccelerator("Cmd+Comma", true)).toBe("⌘,");
    expect(formatAccelerator("Cmd+ArrowUp", true)).toBe("⌘↑");
    expect(formatAccelerator("Cmd+Space", true)).toBe("⌘Space");
  });

  it("passes an unknown token through rather than dropping it", () => {
    expect(formatAccelerator("Hyper+KeyN", false)).toBe("Hyper + N");
  });

  it("is empty for an empty accelerator", () => {
    expect(formatAccelerator("", true)).toBe("");
  });
});

describe("isMacPlatform", () => {
  it("recognises the user agents a webview reports", () => {
    expect(isMacPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isMacPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isMacPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});
