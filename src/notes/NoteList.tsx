import type { Note } from "../lib/ipc";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import styles from "./NoteList.module.css";

interface NoteListProps {
  notes: Note[];
  editingId: string | null;
  onOpen: (id: string) => void;
}

export function NoteList({ notes, editingId, onOpen }: NoteListProps) {
  return (
    <div className={styles.list}>
      {notes.map((note) =>
        note.id === editingId ? (
          // The card expands in place into the editor (brief 6.9).
          <NoteEditor key={note.id} note={note} />
        ) : (
          <NoteCard
            key={note.id}
            note={note}
            onOpen={() => {
              onOpen(note.id);
            }}
          />
        ),
      )}
    </div>
  );
}
