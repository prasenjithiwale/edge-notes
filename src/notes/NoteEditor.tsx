import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { Pin, Trash2 } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import { NOTE_COLORS, type Note } from "../lib/ipc";
import { prefersReducedMotion } from "../lib/motion";
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

/** Brief 6.9: the card expands in place over this long. */
const EXPAND_MS = 160;

/**
 * Where the expansion starts from: about the height of the card that was just
 * replaced. Measuring the outgoing card would mean threading its height through
 * the list for a 160 ms animation; a close-enough constant keeps the growth
 * visible without that.
 */
const CARD_HEIGHT_GUESS = 64;

export function NoteEditor({ note }: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const setContent = useNotesStore((state) => state.setContent);
  const setColor = useNotesStore((state) => state.setColor);
  const stopEditing = useNotesStore((state) => state.stopEditing);
  const remove = useNotesStore((state) => state.remove);
  const setPinned = useNotesStore((state) => state.setPinned);
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

  // Brief 6.9: the card expands in place rather than being swapped for a taller
  // box. Animating `max-height` from roughly the card's height to the editor's
  // own, then letting go of the constraint — it has to be released, or the
  // textarea could not grow as you type.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const target = root.scrollHeight;
    const start = Math.min(target, CARD_HEIGHT_GUESS);
    root.style.overflow = "hidden";
    root.style.maxHeight = `${String(start)}px`;

    const frame = requestAnimationFrame(() => {
      root.style.transition = `max-height ${String(EXPAND_MS)}ms var(--open-easing)`;
      root.style.maxHeight = `${String(target)}px`;
    });

    const release = () => {
      root.style.maxHeight = "";
      root.style.transition = "";
      root.style.overflow = "";
    };
    // Whichever comes first: the transition, or a timer in case it never fires.
    const timer = setTimeout(release, EXPAND_MS + 60);
    root.addEventListener("transitionend", release, { once: true });

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      root.removeEventListener("transitionend", release);
      release();
    };
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

  // The editor can mount before the window has the keyboard — the shortcut opens
  // the panel and asks for a new note in the same breath, and `focus()` on an
  // element in a window that is not yet key does not stick. Re-focus when the
  // window actually gains focus, so the caret is where the typing will go.
  useEffect(() => {
    const refocus = () => {
      const textarea = textareaRef.current;
      if (textarea && document.activeElement !== textarea) {
        textarea.focus();
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      }
    };
    window.addEventListener("focus", refocus);
    return () => {
      window.removeEventListener("focus", refocus);
    };
  }, []);

  useEffect(() => {
    // Hold the panel open while the editor is open (brief 6.3). Counted in the
    // store, because the search field can hold the same lock.
    setLock("editor", true);
    return () => {
      setLock("editor", false);
    };
  }, [setLock]);

  return (
    <section
      ref={rootRef}
      className={styles.editor}
      style={noteColorStyle(note.color)}
    >
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
            style={
              { "--swatch-bg": `var(--note-${color}-bg)` } as CSSProperties
            }
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
          label={note.pinned ? "Unpin note" : "Pin note"}
          className={styles.footerButton}
          // Filled rather than accent-coloured when on: accent is reserved for
          // focus rings and Keep open (brief 7.1).
          pressed={note.pinned}
          onClick={() => {
            void setPinned(note.id, !note.pinned);
          }}
        >
          <Pin
            size={16}
            strokeWidth={1.75}
            fill={note.pinned ? "currentColor" : "none"}
          />
        </IconButton>
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
