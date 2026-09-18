/**
 * Which formatting commands exist and which keys reach them.
 *
 * Applying them is the editor's own job now (`editor/toolbar.ts`): the editor is
 * rich text rather than a textarea full of markers, so a command is a Lexical
 * command rather than a string transform. What is left here is the table both
 * the toolbar and the keyboard read, so a button's tooltip and the key that does
 * the same thing can never drift apart.
 */
import type { FormatCommand } from "./editor/toolbar";

export type { FormatCommand };

export interface FormatShortcut {
  command: FormatCommand;
  label: string;
  /** `KeyboardEvent.code`, because Shift turns `7` into `&` in `key`. */
  code: string;
  shift: boolean;
  /** Option on macOS, Alt elsewhere. Only the headings use it. */
  alt?: boolean;
  /** How the key is written in a tooltip. */
  keyLabel: string;
}

export const FORMAT_SHORTCUTS: readonly FormatShortcut[] = [
  // The headings take Option rather than Shift: ⌘⇧1 is not free everywhere, and
  // ⌘⌥1 is the key every editor that has headings already uses for them.
  { command: "heading1", label: "Heading 1", code: "Digit1", shift: false, alt: true, keyLabel: "1" },
  { command: "heading2", label: "Heading 2", code: "Digit2", shift: false, alt: true, keyLabel: "2" },
  { command: "heading3", label: "Heading 3", code: "Digit3", shift: false, alt: true, keyLabel: "3" },
  { command: "bold", label: "Bold", code: "KeyB", shift: false, keyLabel: "B" },
  { command: "italic", label: "Italic", code: "KeyI", shift: false, keyLabel: "I" },
  { command: "strike", label: "Strikethrough", code: "KeyX", shift: true, keyLabel: "X" },
  { command: "code", label: "Inline code", code: "KeyE", shift: false, keyLabel: "E" },
  { command: "bullet", label: "Bulleted list", code: "Digit8", shift: true, keyLabel: "8" },
  { command: "ordered", label: "Numbered list", code: "Digit7", shift: true, keyLabel: "7" },
  { command: "task", label: "Checklist", code: "Digit9", shift: true, keyLabel: "9" },
  { command: "codeblock", label: "Code block", code: "KeyC", shift: true, keyLabel: "C" },
];

type KeyInput = Pick<
  KeyboardEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "code"
>;

/** The formatting command a key press asks for, if any. */
export function formatCommandForKey(event: KeyInput): FormatCommand | null {
  if (!(event.metaKey || event.ctrlKey)) {
    return null;
  }
  const match = FORMAT_SHORTCUTS.find(
    (shortcut) =>
      shortcut.code === event.code &&
      shortcut.shift === event.shiftKey &&
      (shortcut.alt ?? false) === event.altKey,
  );
  return match?.command ?? null;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** "⌘⇧X" on macOS, "Ctrl+Shift+X" elsewhere; "⌘⌥1" and "Ctrl+Alt+1" for headings. */
export function shortcutLabel(shortcut: FormatShortcut, mac = isMac()): string {
  if (mac) {
    return `⌘${shortcut.alt === true ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${shortcut.keyLabel}`;
  }
  return `Ctrl+${shortcut.alt === true ? "Alt+" : ""}${shortcut.shift ? "Shift+" : ""}${shortcut.keyLabel}`;
}
