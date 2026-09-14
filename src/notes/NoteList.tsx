import type { Note } from "../lib/ipc";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import styles from "./NoteList.module.css";

interface NoteListProps {
  notes: Note[];
  editingId: string | null;
  onOpen: (id: string) => void;
  onUnpin: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleTask: (id: string, line: number) => void;
}

export function NoteList({
  notes,
  editingId,
  onOpen,
  onUnpin,
  onExpand,
  onToggleTask,
}: NoteListProps) {
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
            onUnpin={() => {
              onUnpin(note.id);
            }}
            onExpand={() => {
              onExpand(note.id);
            }}
            onToggleTask={(line) => {
              onToggleTask(note.id, line);
            }}
          />
        ),
      )}
    </div>
  );
}
