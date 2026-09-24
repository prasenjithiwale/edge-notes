/**
 * Typed wrappers for every command and event (brief 9.3).
 * Components never call `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Reminder } from "./tasks";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * The note palette, in the order the full colour grid shows it: around the hue
 * wheel, then the neutrals. Tokens for each live in `tokens.css`, and Rust
 * validates the same ids (`db::notes::NoteColor`).
 */
export const NOTE_COLORS = [
  /**
   * No colour: a neutral card that is still plainly a card. First, because it is
   * the absence of the others rather than one of them — and a stored id like any
   * other, so the column stays non-null and a note always has one answer.
   */
  "none",
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
  "none",
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
  /**
   * Where the note sits in the manual order, or null for one that has never
   * been dragged. Only read when `notes.manualOrder` is on, where a null sorts
   * to the top — a note written since the last drag belongs where it was made.
   */
  sortOrder: number | null;
}

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REPEATS = ["daily", "weekly", "monthly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];

/**
 * Where a task is, in the order a task moves through them.
 *
 * `open` and `in_progress` are the two open statuses; `done` and `cancelled`
 * are the two closed ones, and which of the two a task is in matters — a
 * cancelled task is not a finished one, and a list that pretended otherwise
 * would quietly claim credit for work nobody did.
 *
 * Mirrors `Status` in `db/tasks.rs`, which stores these exact strings.
 */
export const STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * A task, which since v2 of the schema is a row of its own rather than a
 * `- [ ]` line inside a note. Dates are local calendar values, not instants:
 * "the 20th at 2 pm" means that wherever you are.
 */
export interface Task {
  id: string;
  title: string;
  /** Free text under the title: what one line has no room for. */
  notes: string;
  /** Open, in progress, done or cancelled: what is happening with the task. */
  status: Status;
  /**
   * When it closed — completed or cancelled — in Unix milliseconds, or null
   * while it is still open. `status` says which of the two closed it.
   */
  doneAt: number | null;
  /** `YYYY-MM-DD`, local, or null for a task with no date. */
  dueDate: string | null;
  /** `HH:MM`, 24-hour, local, or null for a whole-day task. */
  dueTime: string | null;
  priority: Priority | null;
  repeat: Repeat | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A change to a task. A key that is absent is left alone; a key sent as null is
 * cleared — which is why this is spelled out rather than `Partial<Task>`, and
 * why Rust reads it with a deserializer that can tell the two apart.
 */
export interface TaskPatch {
  title?: string;
  notes?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: Priority | null;
  repeat?: Repeat | null;
}

/**
 * A deleted note or task, still restorable.
 *
 * Both are soft-deleted and purged thirty days later, which undo has always
 * relied on; the archive is the same rows, made visible, so a delete whose toast
 * has gone is not the same as a delete that was final.
 */
export interface ArchivedItem {
  id: string;
  kind: "note" | "task";
  /** A note's whole content, or a task's title. */
  text: string;
  /** The note's palette id; tasks have none. */
  color: NoteColor | null;
  /** Unix milliseconds. */
  deletedAt: number;
  /** When it is purged for good: thirty days after it was deleted. */
  purgeAt: number;
}

/**
 * How protected `notes.db` is on disk.
 *
 * `"on"` is the ordinary state. `"unavailable"` means this system had nowhere
 * safe to keep a key, so the notes are in the clear and say so. `"locked"` means
 * they are encrypted and the key is gone: the panel shows the locked view and
 * nothing else, because there is nothing else to show.
 */
export type Protection = "on" | "unavailable" | "locked";

/**
 * What the app can do to protect what is in it, and what it is doing. A switch
 * the platform cannot honour is not drawn at all.
 */
export interface SecurityStatus {
  /** Whether the panel can be kept out of a capture: macOS and Windows only. */
  captureProtection: boolean;
  protection: Protection;
  /** Why, when it is not simply on. A sentence, meant to be read. */
  detail: string;
}

/** What the About section shows, and what a bug report needs. */
export interface AppInfo {
  name: string;
  version: string;
  /** "macOS", "Windows" or "Linux". */
  os: string;
  arch: string;
  /** Where `notes.db` lives. */
  dataDir: string;
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
  /** How big the collapsed tab is: its window, its hit area and its pill. */
  "tab.size": "small" | "medium" | "large";
  "panel.width": number;
  theme: "system" | "light" | "dark";
  "notes.lastColor": NoteColor;
  /** The language the editor writes after a new code fence; "" for none. */
  "notes.lastCodeLang": string;
  /**
   * A colour for the panel's own chrome, from the note palette. `"none"` is the
   * neutral chrome of brief 7.1 and the default. Not `theme`, which is brief
   * 9.2's light/dark.
   */
  "appearance.accent": NoteColor;
  /** The list is in the order the cards were dragged into (idea 16). */
  "notes.manualOrder": boolean;
  "shortcut.newNote": string;
  /** Quick capture, and a note from the clipboard. Empty means "not bound". */
  "shortcut.quickCapture": string;
  "shortcut.clipboardNote": string;
  /** A system notification when a task is due. */
  "tasks.reminders": boolean;
  /** Keep the panel out of screen shares, recordings and screenshots. */
  "privacy.hideFromCapture": boolean;
  /** How see-through the panel is, 0 (solid) to 60 percent. */
  "panel.translucency": number;
  /** The Focus tab's phase lengths, in minutes. */
  "focus.focusMinutes": number;
  "focus.breakMinutes": number;
  "focus.longBreakMinutes": number;
  /** How many focus sessions earn the long break. */
  "focus.longBreakEvery": number;
  /** Start the next phase by itself when one ends. */
  "focus.autoStart": boolean;
  /**
   * The Focus tab's own state rather than a preference: the task a session is
   * for (empty for none), and the day's tally, so both survive a restart.
   */
  "focus.taskId": string;
  "focus.day": string;
  "focus.today": number;
  "focus.streak": number;
  /** Today's finished focus sessions, `[start, end]` in epoch ms, for the timeline. */
  "focus.log": [number, number][];
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
  /** The panel is the one-line capture field, and nothing else. */
  quick: boolean;
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
 * Whether a rejection from `callResult` carries a particular `AppError` code.
 * The code is the contract (brief 9.3); the message is for people, and is not
 * something to match on.
 */
export function isIpcErrorOf(error: unknown, code: string): boolean {
  return error instanceof Error && isIpcError(error.cause) && error.cause.code === code;
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
/**
 * A picker of ours is in front of the panel. It is not the interaction lock: a
 * blur clears that, and this is here exactly because the blur a picker causes
 * has to be ignored — the panel must still be there when the picker goes.
 */
export function dockSetModal(value: boolean): Promise<void> {
  return call("dock_set_modal", { value });
}

export function dockSetLarge(value: boolean): Promise<void> {
  return call("dock_set_large", { value });
}

/**
 * What the capture field should open with: the clipboard, when that shortcut
 * summoned it, and nothing otherwise. Taken rather than read — the clipboard
 * that summoned the field belongs to that one summoning.
 */
export function quickCapturePrefill(): Promise<string | null> {
  return callResult<string | null>("quick_capture_prefill");
}

/** Leave the capture field, whether or not anything was captured. */
export function quickCaptureClose(keepOpen: boolean): Promise<void> {
  return call("quick_capture_close", { keepOpen });
}

/**
 * What the menu bar counts down to: the moment the running phase ends, or null
 * while it is paused or idle.
 *
 * The frontend computes and Rust keeps time, as with reminders — this panel's
 * own clock stops while it is collapsed, and a countdown driven from it would
 * lose minutes without knowing.
 */
export function focusTimerSet(endsAt: number | null): Promise<void> {
  return call("focus_timer_set", { session: { endsAt } });
}

/** The full list of task reminders; Rust schedules and shows them. */
export function remindersSet(list: Reminder[]): Promise<void> {
  return call("reminders_set", { list });
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

/**
 * Write the manual order: the whole visible list, in the order it is now on
 * screen. Sent whole rather than as one move, because what is being agreed to is
 * what is on screen — and only ever when nothing is filtered out.
 */
/**
 * Store a pasted or dropped image; the name comes back and goes into the note.
 *
 * The bytes go as the whole payload rather than inside an object, which is what
 * Tauri sends as a raw body — a two-megabyte screenshot as a JSON array of
 * numbers is about eight megabytes of text, parsed twice on the way through.
 */
export async function imagesSave(bytes: Uint8Array): Promise<string> {
  return invoke<string>("images_save", bytes);
}

/**
 * Pick images with the system's open panel and store them, in Rust. Null where
 * there is no such picker (everywhere but macOS) and the file input is the one.
 */
export function imagesPick(): Promise<string[] | null> {
  return callResult<string[] | null>("images_pick");
}

/** One note on the clipboard as rich text and plain text at once. */
export async function shareCopyRich(html: string, text: string): Promise<void> {
  await callResult<null>("share_copy_rich", { html, text });
}

/** One note on the clipboard as the Markdown it is stored as. */
export async function shareCopyText(text: string): Promise<void> {
  await callResult<null>("share_copy_text", { text });
}

// -- Clipboard history --------------------------------------------------------

/** One thing copied, anywhere. Kept in Rust's memory only, never on disk. */
export interface Clip {
  id: number;
  text: string;
  /** Unix milliseconds: when it was last copied. */
  copiedAt: number;
  /** This is what is on the clipboard now. */
  current: boolean;
}

export function clipsList(): Promise<Clip[]> {
  return callResult<Clip[]>("clips_list");
}

/** Forget one; the list that is left comes back. */
export function clipsRemove(id: number): Promise<Clip[]> {
  return callResult<Clip[]>("clips_remove", { id });
}

export function clipsClear(): Promise<void> {
  return callResult<null>("clips_clear").then(() => undefined);
}

/** Something was copied; the whole list, newest first. */
export function onClipsChanged(handler: (clips: Clip[]) => void): Promise<UnlistenFn> {
  return listen<Clip[]>("clips:changed", (event) => {
    handler(event.payload);
  });
}

/** Whether this system has a share sheet to offer (macOS today). */
export function shareSheetSupported(): Promise<boolean> {
  return callResult<boolean>("share_sheet_supported");
}

/** The system share sheet, with the note's text and its pictures' files. */
export async function shareSheet(text: string, images: string[]): Promise<void> {
  await callResult<null>("share_sheet", { text, images });
}

export async function notesReorder(ids: string[]): Promise<void> {
  await callResult<null>("notes_reorder", { ids });
}

export async function notesDelete(id: string): Promise<void> {
  await callResult<null>("notes_delete", { id });
}

/** Everything deleted and not yet purged, notes and tasks, newest first. */
export function archiveList(): Promise<ArchivedItem[]> {
  return callResult<ArchivedItem[]>("archive_list");
}

/**
 * Delete one for good, without waiting out its thirty days.
 *
 * The only call in the app that destroys anything and the only one with nothing
 * behind it: Rust will touch nothing but a row that is already in the archive,
 * and the screen asks before sending it.
 */
export async function archivePurge(id: string, kind: ArchivedItem["kind"]): Promise<void> {
  await callResult<null>("archive_purge", { id, kind });
}

export function notesRestore(id: string): Promise<Note> {
  return callResult<Note>("notes_restore", { id });
}

// -- Tasks ------------------------------------------------------------------

export function tasksList(): Promise<Task[]> {
  return callResult<Task[]>("tasks_list");
}

export function tasksCreate(patch: TaskPatch): Promise<Task> {
  return callResult<Task>("tasks_create", { patch });
}

export function tasksUpdate(id: string, patch: TaskPatch): Promise<Task> {
  return callResult<Task>("tasks_update", { id, patch });
}

/**
 * Move a task to a status. Rust stamps the time it closed, or clears that stamp
 * when it opens again, so the two can never disagree.
 *
 * A repeating task never comes through here: the store moves it to its next date
 * with `tasksUpdate` instead, because the calendar arithmetic is the frontend's.
 */
export function tasksSetStatus(id: string, status: Status): Promise<Task> {
  return callResult<Task>("tasks_set_status", { id, status });
}

export async function tasksDelete(id: string): Promise<void> {
  await callResult<null>("tasks_delete", { id });
}

export function tasksRestore(id: string): Promise<Task> {
  return callResult<Task>("tasks_restore", { id });
}

// -- Settings ---------------------------------------------------------------

/** Writes every note out and returns the folder they went to (brief M4). */
export function notesExport(): Promise<string> {
  return callResult<string>("notes_export");
}

/** Monitor names for the settings view; "primary" is handled separately. */
export function appInfo(): Promise<AppInfo> {
  return callResult<AppInfo>("app_info");
}

/** A newer version the feed announced (idea 6). */
export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export interface UpdateStatus {
  /** Why this copy cannot update itself (a `.deb`, a dev build), or null. */
  unavailable: string | null;
  /** What the last check found, if it found anything. */
  found: UpdateInfo | null;
}

export function updateStatus(): Promise<UpdateStatus> {
  return callResult<UpdateStatus>("update_status");
}

/** Ask the feed now; null means this copy is current. */
export function updateCheck(): Promise<UpdateInfo | null> {
  return callResult<UpdateInfo | null>("update_check");
}

/**
 * Download the new version, then save everything pending and restart into it.
 * Resolves once the download is done; the quit follows on its own.
 */
export function updateInstall(): Promise<void> {
  return callResult<null>("update_install").then(() => undefined);
}

/** A background check found a newer version while the panel was up. */
export function onUpdateAvailable(
  handler: (update: UpdateInfo) => void,
): Promise<UnlistenFn> {
  return listen<UpdateInfo>("update:available", (event) => {
    handler(event.payload);
  });
}

export function securityStatus(): Promise<SecurityStatus> {
  return callResult<SecurityStatus>("security_status");
}

/** The database key, written out for someone to keep. The one place it shows. */
export function securityRecoveryKey(): Promise<string> {
  return callResult<string>("security_recovery_key");
}

/** Open a locked database with a key the user kept. */
export function securityUnlock(recovery: string): Promise<SecurityStatus> {
  return callResult<SecurityStatus>("security_unlock", { recovery });
}

/** Set a locked database aside — never delete it — and start again. */
export function securityStartFresh(): Promise<SecurityStatus> {
  return callResult<SecurityStatus>("security_start_fresh");
}

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
 * The global shortcut, which is not set through `settingsUpdate`: Rust registers
 * it with the OS *before* storing it, and rejects an accelerator another app
 * already owns, so the settings field can say so instead of failing silently.
 */
export function shortcutSet(
  which: "newNote" | "quickCapture" | "clipboardNote",
  accelerator: string,
): Promise<Settings> {
  return callResult<Settings>("shortcut_set", { which, accelerator });
}

/** Launch at login, read from the OS rather than from the settings table. */
export function autostartGet(): Promise<boolean> {
  return callResult<boolean>("autostart_get");
}

/** Returns the state the OS reports afterwards, not the one that was asked for. */
export function autostartSet(enabled: boolean): Promise<boolean> {
  return callResult<boolean>("autostart_set", { enabled });
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

/**
 * Images dropped onto the panel, already stored: the names are all the webview
 * is told, because the paths were the window server's and were read in Rust.
 */
export function onImagesDropped(
  handler: (names: string[]) => void,
): Promise<UnlistenFn> {
  return listen<string[]>("images:dropped", (event) => {
    handler(event.payload);
  });
}

export function onSettingsChanged(
  handler: (settings: Settings) => void,
): Promise<UnlistenFn> {
  return listen<Settings>(SETTINGS_CHANGED_EVENT, (event) => {
    handler(event.payload);
  });
}

/** Where the frosted glass goes: the panel's rectangle in CSS pixels. */
export interface Backdrop {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  dark: boolean;
}

/**
 * Put the desktop's blur behind the panel, or take it away with null. Resolves
 * to whether this platform has the glass at all (macOS only); a failure is the
 * same answer, since the panel then simply stays solid.
 */
export async function setBackdrop(backdrop: Backdrop | null): Promise<boolean> {
  try {
    return await invoke<boolean>("backdrop_set", { backdrop });
  } catch {
    return false;
  }
}
