import { create } from "zustand";

import { clipsClear, clipsList, clipsRemove, shareCopyText, type Clip } from "../lib/ipc";

/**
 * The clipboard history, as Rust last described it.
 *
 * Rust watches the clipboard and owns the list; this is a copy, loaded once and
 * replaced whole by every `clips:changed`. Copying an entry back goes through
 * Rust's clipboard (`share_copy_text`) — the webview has no clipboard access
 * of its own when the panel was opened by hover — and Rust then sees the copy
 * and moves the entry to the top, so nothing here reorders anything.
 */
interface ClipsStore {
  clips: Clip[];
  /** The entry just copied back, so its row can say so. */
  copiedId: number | null;

  load: () => Promise<void>;
  replace: (clips: Clip[]) => void;
  copy: (clip: Clip) => Promise<void>;
  remove: (id: number) => Promise<void>;
  clear: () => Promise<void>;
}

/** How long a row says "Copied". */
const COPIED_MS = 1_500;

let copiedTimer: ReturnType<typeof setTimeout> | undefined;

export const useClipsStore = create<ClipsStore>((set) => ({
  clips: [],
  copiedId: null,

  load: async () => {
    try {
      set({ clips: await clipsList() });
    } catch (error: unknown) {
      console.error("clips: load failed", error);
    }
  },

  replace: (clips) => {
    set({ clips });
  },

  copy: async (clip) => {
    try {
      await shareCopyText(clip.text);
    } catch (error: unknown) {
      // Saying "Copied" for a copy that did not happen is worse than silence.
      console.error("clips: copy failed", error);
      return;
    }
    clearTimeout(copiedTimer);
    set({ copiedId: clip.id });
    copiedTimer = setTimeout(() => {
      set({ copiedId: null });
    }, COPIED_MS);
  },

  remove: async (id) => {
    try {
      set({ clips: await clipsRemove(id) });
    } catch (error: unknown) {
      console.error("clips: remove failed", error);
    }
  },

  clear: async () => {
    try {
      await clipsClear();
      set({ clips: [] });
    } catch (error: unknown) {
      console.error("clips: clear failed", error);
    }
  },
}));

/** Plain, case-insensitive substring — the same search the notes and tasks get. */
export function filterClips(clips: Clip[], query: string): Clip[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? clips : clips.filter((clip) => clip.text.toLowerCase().includes(needle));
}
