import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { Trash2 } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import { NOTE_COLORS, type Note } from "../lib/ipc";
import { colorName, editedLabel } from "../lib/notes";
import { useNow } from "../lib/useNow";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { noteColorStyle } from "./NoteCard";
import styles from "./NoteEditor.module.css";

interface NoteEditorProps {
  note: Note;
}

/** Brief 6.9: the textarea grows to about 60% of the panel, then scrolls. */
const MAX_HEIGHT_RATIO = 0.6;

export function NoteEditor({ note }: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setContent = useNotesStore((state) => state.setContent);
  const setColor = useNotesStore((state) => state.setColor);
  const stopEditing = useNotesStore((state) => state.stopEditing);
  const remove = useNotesStore((state) => state.remove);
  const setLock = useDockStore((state) => state.setLock);
  const now = useNow();

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const panel = textarea.closest("[data-panel]");
    const max =
      panel instanceof HTMLElement
        ? panel.clientHeight * MAX_HEIGHT_RATIO
        : Number.POSITIVE_INFINITY;
    textarea.style.height = "auto";
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, max))}px`;
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    // Caret at the end, so typing continues rather than overwrites.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    resize();
  }, [resize]);

  useEffect(() => {
    // Hold the panel open while the editor is open (brief 6.3). Counted in the
    // store, because the search field can hold the same lock.
    setLock("editor", true);
    return () => {
      setLock("editor", false);
    };
  }, [setLock]);

  return (
    <section className={styles.editor} style={noteColorStyle(note.color)}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={note.content}
        rows={1}
        aria-label="Note content"
        placeholder="Write a note"
        onChange={(event) => {
          setContent(note.id, event.target.value);
          resize();
        }}
        onBlur={() => {
          // Save on blur as well as on the debounce (brief 6.9).
          void useNotesStore.getState().flush(note.id);
        }}
      />
      <div className={styles.swatches} role="group" aria-label="Note colour">
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={cx(
              styles.swatch,
              color === note.color && styles.swatchSelected,
            )}
            style={{ "--swatch-bg": `var(--note-${color}-bg)` } as CSSProperties}
            aria-label={colorName(color)}
            aria-pressed={color === note.color}
            title={colorName(color)}
            onClick={() => {
              void setColor(note.id, color);
            }}
          />
        ))}
      </div>
      <footer className={styles.footer}>
        <span className={styles.meta}>{editedLabel(note.updatedAt, now)}</span>
        <IconButton
          label="Delete note"
          className={styles.footerButton}
          onClick={() => {
            void remove(note.id);
          }}
        >
          <Trash2 size={16} strokeWidth={1.75} />
        </IconButton>
        <button
          type="button"
          className={styles.done}
          onClick={() => {
            void stopEditing();
          }}
        >
          Done
        </button>
      </footer>
    </section>
  );
}
