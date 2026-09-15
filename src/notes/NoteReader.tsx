import { Minimize2, Pencil } from "lucide-react";

import { IconButton } from "../components/IconButton";
import type { Note } from "../lib/ipc";
import { editedLabel } from "../lib/notes";
import { useNow } from "../lib/useNow";
import { useNotesStore } from "../store/notes";
import { noteColorStyle } from "./NoteCard";
import { NoteLines } from "./NoteText";
import styles from "./NoteReader.module.css";

interface NoteReaderProps {
  note: Note;
}

/**
 * A note in the large panel, formatted and read-only: what an expanded pinned
 * note shows, and where an expanded note lands after Done. Boxes can still be
 * ticked and links followed, as on a card; changing the text means Edit.
 */
export function NoteReader({ note }: NoteReaderProps) {
  const startEditing = useNotesStore((state) => state.startEditing);
  const shrink = useNotesStore((state) => state.shrink);
  const toggleTask = useNotesStore((state) => state.toggleTask);
  const now = useNow();

  return (
    <section className={styles.reader} style={noteColorStyle(note.color)}>
      <div className={styles.toolbar}>
        <IconButton
          label="Edit note"
          className={styles.button}
          onClick={() => {
            startEditing(note.id);
          }}
        >
          <Pencil size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Shrink note" className={styles.button} onClick={shrink}>
          <Minimize2 size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className={styles.body}>
        <NoteLines
          content={note.content}
          titleClassName={styles.title}
          lineClassName={styles.line}
          onToggle={(index) => {
            toggleTask(note.id, index);
          }}
        />
      </div>
      <footer className={styles.footer}>{editedLabel(note.updatedAt, now)}</footer>
    </section>
  );
}
