import type { CSSProperties } from "react";

import { cx } from "../lib/cx";
import type { Note } from "../lib/ipc";
import { notePreview, noteTitle } from "../lib/notes";
import styles from "./NoteCard.module.css";

interface NoteCardProps {
  note: Note;
  onOpen: () => void;
}

export function noteColorStyle(color: string): CSSProperties {
  return {
    "--note-bg": `var(--note-${color}-bg)`,
    "--note-text": `var(--note-${color}-text)`,
  } as CSSProperties;
}

export function NoteCard({ note, onOpen }: NoteCardProps) {
  const title = noteTitle(note.content);
  const preview = notePreview(note.content);

  return (
    <button
      type="button"
      className={styles.card}
      style={noteColorStyle(note.color)}
      onClick={onOpen}
    >
      <div className={cx(styles.title, title === "" && styles.untitled)}>
        {title === "" ? "New note" : title}
      </div>
      {preview !== "" && <div className={styles.preview}>{preview}</div>}
    </button>
  );
}
