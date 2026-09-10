import { useEffect } from "react";
import { Pin, Plus } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { Toast } from "../components/Toast";
import { cx } from "../lib/cx";
import { onSettingsChanged } from "../lib/ipc";
import { EmptyState } from "../notes/EmptyState";
import { NoteList } from "../notes/NoteList";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { useSettingsStore } from "../store/settings";
import styles from "./Panel.module.css";

interface PanelProps {
  className: string;
}

export function Panel({ className }: PanelProps) {
  const keepOpen = useDockStore((state) => state.keepOpen);
  const setKeepOpen = useDockStore((state) => state.setKeepOpen);

  const notes = useNotesStore((state) => state.notes);
  const loaded = useNotesStore((state) => state.loaded);
  const editingId = useNotesStore((state) => state.editingId);
  const pendingUndo = useNotesStore((state) => state.pendingUndo);
  const load = useNotesStore((state) => state.load);
  const createNote = useNotesStore((state) => state.createNote);
  const startEditing = useNotesStore((state) => state.startEditing);
  const undoRemove = useNotesStore((state) => state.undoRemove);

  const loadSettings = useSettingsStore((state) => state.load);
  const applySettings = useSettingsStore((state) => state.apply);

  useEffect(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);

  useEffect(() => {
    const unlisten = onSettingsChanged(applySettings);
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [applySettings]);

  const isEmpty = loaded && notes.length === 0;

  return (
    <section className={cx(className, styles.panel)} data-slide="true" data-panel="">
      <header className={styles.header}>
        <h1 className={styles.title}>Notes</h1>
        <div className={styles.actions}>
          {/* Search lands in M2, between the title and Keep open. */}
          <IconButton
            label="Keep open"
            active={keepOpen}
            pressed={keepOpen}
            onClick={() => {
              setKeepOpen(!keepOpen);
            }}
          >
            <Pin size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="New note"
            outlined
            onClick={() => {
              void createNote();
            }}
          >
            <Plus size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      {isEmpty ? (
        <EmptyState
          onCreate={() => {
            void createNote();
          }}
        />
      ) : (
        <NoteList notes={notes} editingId={editingId} onOpen={startEditing} />
      )}

      {pendingUndo && (
        <Toast
          message="Note deleted"
          actionLabel="Undo"
          onAction={() => {
            void undoRemove();
          }}
        />
      )}
    </section>
  );
}
