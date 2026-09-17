/**
 * The editor's side of lightweight formatting: which commands exist, which keys
 * reach them, and applying an edit to the real textarea. The transforms
 * themselves are pure and live in `lib/markdown.ts`.
 */
import {
  continueList,
  toggleCodeBlock,
  toggleInline,
  toggleList,
  type InlineMarker,
  type ListKind,
  type TextEdit,
  type TextState,
} from "../lib/markdown";

export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bullet"
  | "ordered"
  | "task"
  | "codeblock";

export interface FormatShortcut {
  command: FormatCommand;
  label: string;
  /** `KeyboardEvent.code`, because Shift turns `7` into `&` in `key`. */
  code: string;
  shift: boolean;
  /** How the key is written in a tooltip. */
  keyLabel: string;
}

export const FORMAT_SHORTCUTS: readonly FormatShortcut[] = [
  { command: "bold", label: "Bold", code: "KeyB", shift: false, keyLabel: "B" },
  { command: "italic", label: "Italic", code: "KeyI", shift: false, keyLabel: "I" },
  { command: "strike", label: "Strikethrough", code: "KeyX", shift: true, keyLabel: "X" },
  { command: "code", label: "Inline code", code: "KeyE", shift: false, keyLabel: "E" },
  { command: "bullet", label: "Bulleted list", code: "Digit8", shift: true, keyLabel: "8" },
  { command: "ordered", label: "Numbered list", code: "Digit7", shift: true, keyLabel: "7" },
  { command: "task", label: "Checklist", code: "Digit9", shift: true, keyLabel: "9" },
  { command: "codeblock", label: "Code block", code: "KeyC", shift: true, keyLabel: "C" },
];

const INLINE: Partial<Record<FormatCommand, InlineMarker>> = {
  bold: "**",
  italic: "_",
  strike: "~~",
  code: "`",
};

type KeyInput = Pick<
  KeyboardEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "code"
>;

/** The formatting command a key press asks for, if any. */
export function formatCommandForKey(event: KeyInput): FormatCommand | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null;
  }
  const match = FORMAT_SHORTCUTS.find(
    (shortcut) => shortcut.code === event.code && shortcut.shift === event.shiftKey,
  );
  return match?.command ?? null;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** "⌘⇧X" on macOS, "Ctrl+Shift+X" elsewhere. */
export function shortcutLabel(shortcut: FormatShortcut, mac = isMac()): string {
  if (mac) {
    return `⌘${shortcut.shift ? "⇧" : ""}${shortcut.keyLabel}`;
  }
  return `Ctrl+${shortcut.shift ? "Shift+" : ""}${shortcut.keyLabel}`;
}

/** Marks the note editor's textarea, so the window key handler can find it. */
export const EDITOR_FIELD_ATTRIBUTE = "data-note-editor";

export function noteEditorField(target: EventTarget | null): HTMLTextAreaElement | null {
  return target instanceof HTMLTextAreaElement && target.hasAttribute(EDITOR_FIELD_ATTRIBUTE)
    ? target
    : null;
}

function stateOf(textarea: HTMLTextAreaElement): TextState {
  return {
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
  };
}

/**
 * Apply an edit as though it had been typed. `insertText` goes through the
 * browser's own editing path, so Cmd+Z undoes a formatting change like any other
 * keystroke — assigning `value` would silently wipe the undo stack. It is
 * deprecated but still implemented by WebKit, WebView2 and WebKitGTK; where it is
 * missing (jsdom, or some future engine) the range is replaced directly and an
 * `input` event keeps React's onChange in the loop.
 */
export function applyTextEdit(textarea: HTMLTextAreaElement, edit: TextEdit): void {
  if (document.activeElement !== textarea) {
    textarea.focus();
  }
  textarea.setSelectionRange(edit.start, edit.end);

  if (edit.start !== edit.end || edit.text !== "") {
    if (!insertNatively(edit.text)) {
      textarea.setRangeText(edit.text, edit.start, edit.end, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}

/** True when the browser's editing path took the insertion (see above). */
function insertNatively(text: string): boolean {
  /* eslint-disable @typescript-eslint/no-deprecated --
     execCommand is the only way to change a textarea that keeps its undo stack. */
  if (typeof document.execCommand !== "function") {
    return false;
  }
  try {
    return text === ""
      ? document.execCommand("delete")
      : document.execCommand("insertText", false, text);
  } catch {
    return false;
  }
  /* eslint-enable @typescript-eslint/no-deprecated */
}

/**
 * Apply a formatting command. Every transform returns null when it declines —
 * which is what all of them do inside a fenced code block, where the text is
 * meant to be exact and a stray `**` would be part of the code.
 *
 * `lang` is only read by the code-block command: it is what goes after the
 * opening fence.
 */
export function applyFormat(
  textarea: HTMLTextAreaElement,
  command: FormatCommand,
  lang = "",
): void {
  const state = stateOf(textarea);
  const marker = INLINE[command];
  const edit =
    command === "codeblock"
      ? toggleCodeBlock(state, lang)
      : marker !== undefined
        ? toggleInline(state, marker)
        : toggleList(state, command as ListKind);
  if (edit !== null) {
    applyTextEdit(textarea, edit);
  }
}

/** Enter in a list item. True when it was handled and the newline is not needed. */
export function applyListContinuation(textarea: HTMLTextAreaElement): boolean {
  const edit = continueList(stateOf(textarea));
  if (edit === null) {
    return false;
  }
  applyTextEdit(textarea, edit);
  return true;
}
