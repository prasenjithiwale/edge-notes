// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  applyTextEdit,
  FORMAT_SHORTCUTS,
  formatCommandForKey,
  noteEditorField,
  shortcutLabel,
} from "./formatting";

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

describe("noteEditorField", () => {
  it("recognises only the marked textarea", () => {
    const marked = document.createElement("textarea");
    marked.setAttribute("data-note-editor", "");
    expect(noteEditorField(marked)).toBe(marked);
    expect(noteEditorField(document.createElement("textarea"))).toBeNull();
    expect(noteEditorField(document.createElement("input"))).toBeNull();
    expect(noteEditorField(null)).toBeNull();
  });
});

describe("applyTextEdit without execCommand", () => {
  it("replaces the range, announces the input, and sets the selection", () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.value = "say hello";
    const onInput = vi.fn();
    field.addEventListener("input", onInput);

    applyTextEdit(field, {
      start: 4,
      end: 9,
      text: "**hello**",
      selectionStart: 6,
      selectionEnd: 11,
    });

    expect(field.value).toBe("say **hello**");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect([field.selectionStart, field.selectionEnd]).toEqual([6, 11]);
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("does nothing to the text for an empty edit", () => {
    const field = document.createElement("textarea");
    field.value = "abc";
    const onInput = vi.fn();
    field.addEventListener("input", onInput);
    applyTextEdit(field, { start: 1, end: 1, text: "", selectionStart: 1, selectionEnd: 1 });
    expect(field.value).toBe("abc");
    expect(onInput).not.toHaveBeenCalled();
  });
});
