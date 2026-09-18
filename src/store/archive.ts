import { create } from "zustand";

import { archiveList, notesRestore, tasksRestore, type ArchivedItem } from "../lib/ipc";
import { useNotesStore } from "./notes";
import { useTasksStore } from "./tasks";

/**
 * What has been deleted and can still be brought back.
 *
 * The rows were always there — everything is soft-deleted for thirty days so
 * undo has something to undo — but nothing could see them, so a note whose
 * undo toast had gone looked destroyed. This store is the list, and the two
 * restore commands it puts things back through are the ones undo already used.
 *
 * It is loaded when the panel opens and refreshed by whatever changes it, rather
 * than subscribing to the other stores: a delete is a rare event and a query
 * over an indexed column is cheap, so the simple thing is also the fast one.
 */
interface ArchiveStore {
  items: ArchivedItem[];
  loaded: boolean;
  /** The row being put back, so its button can say so and not be pressed twice. */
  restoringId: string | null;

  load: () => Promise<void>;
  restore: (item: ArchivedItem) => Promise<void>;
}

export const useArchiveStore = create<ArchiveStore>((set, get) => ({
  items: [],
  loaded: false,
  restoringId: null,

  load: async () => {
    try {
      set({ items: await archiveList(), loaded: true });
    } catch (error: unknown) {
      // An empty archive is wrong but harmless; a panel that will not paint is
      // not. The same rule the notes and tasks lists follow.
      console.error("archive: load failed", error);
      set({ loaded: true });
    }
  },

  /**
   * Put one back, and tell the list it belongs to.
   *
   * The restored row has to reach the notes or tasks store as well as leave this
   * one, and reloading that store is what guarantees it lands in the right place
   * — a note returns to where its `updated_at` puts it, which is deliberately
   * not the top.
   */
  restore: async (item) => {
    if (get().restoringId !== null) {
      return;
    }
    set({ restoringId: item.id });
    try {
      if (item.kind === "note") {
        await notesRestore(item.id);
        await useNotesStore.getState().load();
      } else {
        await tasksRestore(item.id);
        await useTasksStore.getState().load();
      }
      set((state) => ({
        items: state.items.filter((candidate) => candidate.id !== item.id),
      }));
    } catch (error: unknown) {
      console.error("archive: restore failed", error);
      await get().load();
    } finally {
      set({ restoringId: null });
    }
  },
}));

/**
 * Read the archive again after something has changed it.
 *
 * Called by the delete and undo paths in the other two stores, which is the
 * whole of the coupling between them: they do not know what the archive shows,
 * only that they have changed what there is to show.
 */
export function refreshArchive(): void {
  void useArchiveStore.getState().load();
}
