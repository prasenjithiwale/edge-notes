/**
 * Typed wrappers for every command and event (brief 9.3).
 * Components never call `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
