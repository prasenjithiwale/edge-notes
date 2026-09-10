import { useCallback, useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { dockSetInteractionLock } from "../lib/ipc";
import type { Note } from "../lib/ipc";
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
  const stopEditing = useNotesStore((state) => state.stopEditing);
  const remove = useNotesStore((state) => state.remove);

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
    // Hold the panel open while the editor has focus (brief 6.3).
    void dockSetInteractionLock(true);
    return () => {
      void dockSetInteractionLock(false);
    };
  }, []);

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
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Esc closes the editor first; the panel is the next Esc (brief 6.11).
            event.stopPropagation();
            void stopEditing();
          }
        }}
      />
      <footer className={styles.footer}>
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
