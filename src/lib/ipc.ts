/**
 * Typed wrappers for every command and event (brief 9.3).
 * Components never call `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const NOTE_COLORS = [
  "yellow",
  "peach",
  "pink",
  "lavender",
  "blue",
  "mint",
  "gray",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Note {
  id: string;
  content: string;
  color: NoteColor;
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
}

/** The shape Rust serializes `AppError` into. */
export interface IpcError {
  code: string;
  message: string;
}

const DOCK_STATE_EVENT = "dock:state";
const SETTINGS_CHANGED_EVENT = "settings:changed";
const NEW_NOTE_EVENT = "ui:new-note";

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

export async function notesDelete(id: string): Promise<void> {
  await callResult<null>("notes_delete", { id });
}

export function notesRestore(id: string): Promise<Note> {
  return callResult<Note>("notes_restore", { id });
}

// -- Settings ---------------------------------------------------------------

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

export function onSettingsChanged(
  handler: (settings: Settings) => void,
): Promise<UnlistenFn> {
  return listen<Settings>(SETTINGS_CHANGED_EVENT, (event) => {
    handler(event.payload);
  });
}
