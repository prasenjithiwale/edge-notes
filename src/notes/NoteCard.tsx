import type { CSSProperties } from "react";
import { Pencil, Pin } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import type { Note } from "../lib/ipc";
import { notePreview, noteTitle } from "../lib/notes";
import styles from "./NoteCard.module.css";

interface NoteCardProps {
  note: Note;
  onOpen: () => void;
  onUnpin: () => void;
}

export function noteColorStyle(color: string): CSSProperties {
  return {
    "--note-bg": `var(--note-${color}-bg)`,
    "--note-text": `var(--note-${color}-text)`,
  } as CSSProperties;
}

function Body({ note }: { note: Note }) {
  const title = noteTitle(note.content);
  const preview = notePreview(note.content);

  return (
    <>
      <div className={cx(styles.title, title === "" && styles.untitled)}>
        {title === "" ? "New note" : title}
      </div>
      {preview !== "" && <div className={styles.preview}>{preview}</div>}
    </>
  );
}

/**
 * An unpinned card is one big button: click anywhere and the editor opens
 * (brief 6.8).
 *
 * A pinned one is not. Its text is selectable so it can be read and copied
 * without touching it, and the only way into the editor is the pencil — the
 * point of pinning a note is that you stop editing it by accident.
 */
export function NoteCard({ note, onOpen, onUnpin }: NoteCardProps) {
  if (!note.pinned) {
    return (
      <button
        type="button"
        className={styles.card}
        style={noteColorStyle(note.color)}
        // Markers for arrow-key navigation and for restoring focus to this card
        // when its editor closes (brief 6.11).
        data-card=""
        data-id={note.id}
        onClick={onOpen}
      >
        <Body note={note} />
      </button>
    );
  }

  return (
    <div className={cx(styles.card, styles.pinned)} style={noteColorStyle(note.color)}>
      <div className={styles.text}>
        <Body note={note} />
      </div>
      <div className={styles.tools}>
        {/* Not `active`: accent is reserved for focus rings and Keep open
            (brief 7.1). A filled pin in the note's own colour says "pinned". */}
        <IconButton
          label="Unpin note"
          className={styles.tool}
          pressed
          onClick={onUnpin}
        >
          <Pin size={14} strokeWidth={1.75} fill="currentColor" />
        </IconButton>
        <IconButton
          label="Edit note"
          className={styles.tool}
          // The keyboard's way in, so arrow keys and Enter still reach a pinned
          // note (brief 6.11) even though the card itself is no longer a button.
          data-card=""
          data-id={note.id}
          onClick={onOpen}
        >
          <Pencil size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
