/**
 * The global shortcut, as the OS names it and as a person reads it.
 *
 * The settings field used to be free text holding Tauri's own accelerator
 * syntax ("CmdOrCtrl+Alt+N"), which asked the user to know a format that is
 * neither documented in the app nor how macOS writes a shortcut anywhere else.
 * These two functions are the whole translation: a key press becomes an
 * accelerator, and an accelerator becomes something to read.
 *
 * The token names match `global-hotkey`'s parser, verified against the crate
 * source: modifiers are Ctrl / Alt / Shift / Cmd (Super off macOS), and the key
 * is a `KeyboardEvent.code` value, which that parser already accepts verbatim.
 */

/** Modifier `code` values, which can never be the key of a shortcut. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
]);

/** How each accelerator token is drawn on macOS. */
const MAC_SYMBOLS: Record<string, string> = {
  CTRL: "⌃",
  CONTROL: "⌃",
  ALT: "⌥",
  OPTION: "⌥",
  SHIFT: "⇧",
  CMD: "⌘",
  COMMAND: "⌘",
  SUPER: "⌘",
  META: "⌘",
  CMDORCTRL: "⌘",
  COMMANDORCONTROL: "⌘",
};

/** ...and everywhere else, where modifiers are spelled out. */
const OTHER_NAMES: Record<string, string> = {
  CTRL: "Ctrl",
  CONTROL: "Ctrl",
  ALT: "Alt",
  OPTION: "Alt",
  SHIFT: "Shift",
  CMD: "Win",
  COMMAND: "Win",
  SUPER: "Win",
  META: "Win",
  CMDORCTRL: "Ctrl",
  COMMANDORCONTROL: "Ctrl",
};

/** Keys whose `code` reads badly on a key cap. */
const KEY_LABELS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/**
 * From the user agent rather than `navigator.platform`, which is deprecated.
 * This decides how a shortcut is drawn, never what it binds to, so the coarse
 * test is enough.
 */
export function isMacPlatform(platform: string = navigator.userAgent): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

/** "KeyN" → "N", "Digit1" → "1", "Comma" → ",", "F5" → "F5". */
function keyLabel(token: string): string {
  const mapped = KEY_LABELS[token];
  if (mapped !== undefined) {
    return mapped;
  }
  if (token.startsWith("Key") && token.length === 4) {
    return token.slice(3);
  }
  if (token.startsWith("Digit") && token.length === 6) {
    return token.slice(5);
  }
  return token;
}

/**
 * The accelerator a key press should bind to, or `null` when the press is not a
 * shortcut on its own.
 *
 * A bare key is refused: a global shortcut with no modifier takes that key away
 * from every other application, which is never what someone means. Shift alone
 * does not count as a modifier for the same reason.
 */
export function acceleratorFromEvent(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (event.code === "" || MODIFIER_CODES.has(event.code)) {
    return null;
  }
  if (!event.ctrlKey && !event.altKey && !event.metaKey) {
    return null;
  }

  const parts: string[] = [];
  // macOS writes modifiers in this order, and so does every other platform once
  // Cmd is read as Super, so one order serves both.
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.metaKey) {
    parts.push("Cmd");
  }
  parts.push(event.code);
  return parts.join("+");
}

/**
 * An accelerator as a person reads it: "⌃⌥⇧⌘N" on macOS, "Ctrl + Alt + N"
 * elsewhere. Unknown tokens are passed through rather than dropped, so a value
 * stored by an older version still shows something true.
 */
export function formatAccelerator(accelerator: string, mac: boolean = isMacPlatform()): string {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (tokens.length === 0) {
    return "";
  }

  const table = mac ? MAC_SYMBOLS : OTHER_NAMES;
  const parts = tokens.map((token, index) => {
    const modifier = table[token.toUpperCase()];
    if (modifier !== undefined) {
      return modifier;
    }
    // The last token is the key; anything else unknown is left as it is.
    return index === tokens.length - 1 ? keyLabel(token) : token;
  });

  return mac ? parts.join("") : parts.join(" + ");
}
