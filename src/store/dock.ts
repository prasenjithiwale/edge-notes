import { create } from "zustand";

import {
  dockSetInteractionLock,
  dockSetKeepOpen,
  type DockPhase,
  type DockSide,
  type DockState,
} from "../lib/ipc";

/**
 * Who is holding the panel open (brief 6.3). The editor and the search field can
 * hold it at the same time, so the lock is counted by owner rather than a plain
 * boolean: with one flag, closing the editor while the search field still had
 * focus would release a lock that is still needed.
 */
export type LockOwner = "editor" | "search" | "settings" | "expanded" | "todo";

interface DockStore {
  phase: DockPhase;
  side: DockSide;
  tabTop: number;
  keepOpen: boolean;
  /** Logical panel width, as Rust sized the window for it. */
  panelWidth: number;
  /** Rust has grown the window for an expanded note. */
  large: boolean;
  locks: ReadonlySet<LockOwner>;
  /** Rust owns the phase; this only mirrors it. */
  applyState: (state: DockState) => void;
  setKeepOpen: (value: boolean) => void;
  setLock: (owner: LockOwner, held: boolean) => void;
}

export const useDockStore = create<DockStore>((set, get) => ({
  phase: "collapsed",
  side: "right",
  tabTop: 0,
  keepOpen: false,
  panelWidth: 320,
  large: false,
  locks: new Set<LockOwner>(),
  applyState: (state) => {
    set({
      phase: state.phase,
      side: state.side,
      tabTop: state.tabTop,
      keepOpen: state.keepOpen,
      panelWidth: state.panelWidth,
      large: state.large,
    });
  },
  setKeepOpen: (value) => {
    // Optimistic: Rust echoes the authoritative value back on dock:state.
    set({ keepOpen: value });
    void dockSetKeepOpen(value);
  },
  setLock: (owner, held) => {
    const locks = new Set(get().locks);
    const wasLocked = locks.size > 0;
    if (held) {
      locks.add(owner);
    } else {
      locks.delete(owner);
    }
    set({ locks });

    // Rust only cares about the aggregate, and only when it flips.
    const isLocked = locks.size > 0;
    if (isLocked !== wasLocked) {
      void dockSetInteractionLock(isLocked);
    }
  },
}));
