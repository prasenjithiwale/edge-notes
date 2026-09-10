import { create } from "zustand";

import {
  dockSetInteractionLock,
  dockSetKeepOpen,
  type DockPhase,
  type DockSide,
  type DockState,
} from "../lib/ipc";

interface DockStore {
  phase: DockPhase;
  side: DockSide;
  tabTop: number;
  keepOpen: boolean;
  /** Rust owns the phase; this only mirrors it. */
  applyState: (state: DockState) => void;
  setKeepOpen: (value: boolean) => void;
  setInteractionLock: (value: boolean) => void;
}

export const useDockStore = create<DockStore>((set) => ({
  phase: "collapsed",
  side: "right",
  tabTop: 0,
  keepOpen: false,
  applyState: (state) => {
    set({
      phase: state.phase,
      side: state.side,
      tabTop: state.tabTop,
      keepOpen: state.keepOpen,
    });
  },
  setKeepOpen: (value) => {
    // Optimistic: Rust echoes the authoritative value back on dock:state.
    set({ keepOpen: value });
    void dockSetKeepOpen(value);
  },
  setInteractionLock: (value) => {
    void dockSetInteractionLock(value);
  },
}));
