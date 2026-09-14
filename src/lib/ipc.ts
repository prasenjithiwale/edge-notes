/**
 * Typed wrappers for every command and event (brief 9.3).
 * Components never call `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * The note palette, in the order the full colour grid shows it: around the hue
 * wheel, then the neutrals. Tokens for each live in `tokens.css`, and Rust
 * validates the same ids (`db::notes::NoteColor`).
 */
export const NOTE_COLORS = [
  "red",
  "peach",
  "orange",
  "yellow",
  "lime",
  "green",
  "mint",
  "teal",
  "sky",
  "blue",
  "indigo",
  "lavender",
  "purple",
  "pink",
  "sand",
  "gray",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

/** Brief 7.3's original seven: the quick swatches before any colour has history. */
export const CLASSIC_COLORS: readonly NoteColor[] = [
  "yellow",
  "peach",
  "pink",
  "lavender",
  "blue",
  "mint",
  "gray",
];

export interface Note {
  id: string;
  content: string;
  color: NoteColor;
  /** Pinned notes sort first and are read-only until their edit button is used. */
  pinned: boolean;
  /** Unix milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/** Keys mirror the dotted names used in the settings table (brief 9.2). */
export interface Settings {
  "dock.side": DockSide;
  "dock.monitor": string;
  "dock.tabOffset": number;
  "dock.openDelayMs": number;
  "dock.closeDelayMs": number;
  /** What opens a collapsed panel: resting the cursor on the tab, or clicking it. */
  "dock.openOn": "hover" | "click";
  /** How the collapsed tab is painted; it is always solid while the panel is out. */
  "tab.appearance": "translucent" | "solid";
  "panel.width": number;
  theme: "system" | "light" | "dark";
  "notes.lastColor": NoteColor;
  "shortcut.newNote": string;
}

export type SettingsPatch = Partial<Settings>;

export type DockPhase = "collapsed" | "opening" | "open" | "closing";
export type DockSide = "left" | "right";

export interface DockState {
  phase: DockPhase;
  side: DockSide;
  /** Offset of the tab from the top of the window, in logical pixels. */
  tabTop: number;
  keepOpen: boolean;
  /** Logical width to paint the panel at: `panel.width`, or the large panel's. */
  panelWidth: number;
  /** A note is expanded into the large panel. */
  large: boolean;
}

/** The shape Rust serializes `AppError` into. */
export interface IpcError {
  code: string;
  message: string;
}

const DOCK_STATE_EVENT = "dock:state";
const SETTINGS_CHANGED_EVENT = "settings:changed";
const NEW_NOTE_EVENT = "ui:new-note";
const QUIT_REQUESTED_EVENT = "app:quit-requested";

function isIpcError(value: unknown): value is IpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

/**
 * Commands are fire-and-forget from the UI's point of view: a failure must never
 * break the panel, so it is logged rather than thrown.
 */
async function call(command: string, args?: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args);
  } catch (error: unknown) {
    if (isIpcError(error)) {
      console.error(`ipc: ${command} failed [${error.code}]: ${error.message}`);
    } else {
      console.error(`ipc: ${command} failed:`, error);
    }
  }
}

/**
 * A command whose result the caller needs. Unlike the fire-and-forget dock
 * commands, a failure here has to surface: the caller decides whether to roll
 * back optimistic state.
 */
async function callResult<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    if (isIpcError(error)) {
      throw new Error(`${command} failed [${error.code}]: ${error.message}`, {
        cause: error,
      });
    }
    throw error instanceof Error
      ? error
      : new Error(String(error), { cause: error });
  }
}

/** The frontend has painted; Rust may now show the window. */
export function appReady(): Promise<void> {
  return call("app_ready");
}

/** Pending notes are saved; Rust may exit now (answers `app:quit-requested`). */
export function appQuit(): Promise<void> {
  return call("app_quit");
}

export function dockSetKeepOpen(value: boolean): Promise<void> {
  return call("dock_set_keep_open", { value });
}

export function dockSetInteractionLock(value: boolean): Promise<void> {
  return call("dock_set_interaction_lock", { value });
}

export function dockAnimationDone(phase: DockPhase): Promise<void> {
  return call("dock_animation_done", { phase });
}

export function dockToggle(): Promise<void> {
  return call("dock_toggle");
}

/** Grow the open panel for an expanded note, or return it to normal. */
export function dockSetLarge(value: boolean): Promise<void> {
  return call("dock_set_large", { value });
}

/** Open a web link from a note in the default browser. */
export function openUrl(url: string): Promise<void> {
  return call("open_url", { url });
}

/**
 * Brief M4: the tab can be dragged along the edge. Rust drives it from the
 * cursor it already polls — the window moves with the tab, so the frontend's own
 * coordinates shift under the pointer mid-drag.
 */
export function dockBeginTabDrag(): Promise<void> {
  return call("dock_begin_tab_drag");
}

export function dockEndTabDrag(): Promise<void> {
  return call("dock_end_tab_drag");
}

/** Linux secondary close signal (brief 8.10). */
export function dockPointerLeft(): Promise<void> {
  return call("dock_pointer_left");
}

export function onDockState(
  handler: (state: DockState) => void,
): Promise<UnlistenFn> {
  return listen<DockState>(DOCK_STATE_EVENT, (event) => {
    handler(event.payload);
  });
}

// -- Notes ------------------------------------------------------------------

export function notesList(): Promise<Note[]> {
  return callResult<Note[]>("notes_list");
}

export function notesCreate(color: NoteColor): Promise<Note> {
  return callResult<Note>("notes_create", { color });
}

export function notesUpdate(
  id: string,
  changes: { content?: string; color?: NoteColor },
): Promise<Note> {
  return callResult<Note>("notes_update", {
    id,
    content: changes.content ?? null,
    color: changes.color ?? null,
  });
}

export function notesSetPinned(id: string, pinned: boolean): Promise<Note> {
  return callResult<Note>("notes_set_pinned", { id, pinned });
}

export async function notesDelete(id: string): Promise<void> {
  await callResult<null>("notes_delete", { id });
}

export function notesRestore(id: string): Promise<Note> {
  return callResult<Note>("notes_restore", { id });
}

// -- Settings ---------------------------------------------------------------

/** Writes every note out and returns the folder they went to (brief M4). */
export function notesExport(): Promise<string> {
  return callResult<string>("notes_export");
}

/** Monitor names for the settings view; "primary" is handled separately. */
export function monitorsList(): Promise<string[]> {
  return callResult<string[]>("monitors_list");
}

export function settingsGet(): Promise<Settings> {
  return callResult<Settings>("settings_get");
}

export function settingsUpdate(patch: SettingsPatch): Promise<Settings> {
  return callResult<Settings>("settings_update", { patch });
}

/**
 * Brief 9.4: the tray and the global shortcut ask for a new note. Rust has
 * already shown the panel by the time this arrives.
 */
export function onNewNoteRequested(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen<null>(NEW_NOTE_EVENT, () => {
    handler();
  });
}

/**
 * The tray's Quit: save anything the autosave debounce is still holding, then
 * call `appQuit`. Rust exits on its own after a timeout if that never happens.
 */
export function onQuitRequested(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(QUIT_REQUESTED_EVENT, () => {
    handler();
  });
}

export function onSettingsChanged(
  handler: (settings: Settings) => void,
): Promise<UnlistenFn> {
  return listen<Settings>(SETTINGS_CHANGED_EVENT, (event) => {
    handler(event.payload);
  });
}
