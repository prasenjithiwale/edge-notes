import { useEffect, useRef, useState } from "react";

import {
  notesCreate,
  notesUpdate,
  quickCaptureClose,
  quickCapturePrefill,
  tasksCreate,
} from "../lib/ipc";
import { parseTaskText } from "../lib/taskMeta";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { useSettingsStore } from "../store/settings";
import { useTasksStore } from "../store/tasks";
import styles from "./QuickCapture.module.css";

/**
 * Brief 14: one line to put a thought into, summoned by its own shortcut from
 * wherever you are.
 *
 * The whole point is that it is not the panel: no list, no tabs, no toolbar, and
 * it is gone the moment it has what you typed. Enter saves and closes, Escape
 * closes without saving. **A line that starts with `[ ]` becomes a task** rather
 * than a note, through the same quick-entry parser the Tasks tab's add field
 * uses, so `[ ] call the bank @tomorrow 2pm !high` arrives complete.
 *
 * The clipboard shortcut opens this same field with the clipboard already in it
 * — seeing what is about to be saved, and being able to fix it, beats a note
 * appearing somewhere out of sight.
 */
export function QuickCapture() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const setLock = useDockStore((state) => state.setLock);
  const keepOpen = useDockStore((state) => state.keepOpen);
  const loadNotes = useNotesStore((state) => state.load);
  const loadTasks = useTasksStore((state) => state.load);

  // The cursor is wherever it was when the shortcut was pressed, which is
  // usually nowhere near the panel: without a lock the close delay would take
  // the field away mid-sentence (brief 6.3).
  useEffect(() => {
    setLock("quick", true);
    return () => {
      setLock("quick", false);
    };
  }, [setLock]);

  useEffect(() => {
    inputRef.current?.focus();
    // macOS hands the panel the keyboard a moment after it is ordered in, so a
    // field focused before that never sees the first keystroke. Re-focusing when
    // the window becomes key is what makes the very first letter land.
    const onWindowFocus = () => {
      inputRef.current?.focus();
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

  useEffect(() => {
    // Whatever summoned the field may have brought the clipboard with it.
    void quickCapturePrefill()
      .then((prefill) => {
        if (prefill != null && prefill !== "") {
          setText(prefill);
          // The caret goes to the end, so Enter is the next thing that happens.
          requestAnimationFrame(() => {
            const field = inputRef.current;
            field?.setSelectionRange(prefill.length, prefill.length);
          });
        }
      })
      .catch((error: unknown) => {
        console.error("quick capture: could not read what it was opened with", error);
      });
  }, []);

  const close = () => {
    // Released before the close, not by the unmount that follows it: Rust reads
    // the lock as it decides whether to stay out.
    setLock("quick", false);
    void quickCaptureClose(keepOpen).catch((error: unknown) => {
      console.error("quick capture: could not close", error);
    });
  };

  const save = () => {
    const written = text.trim();
    if (written === "" || saving) {
      close();
      return;
    }
    setSaving(true);

    const task = asTask(written);
    const work =
      task === null
        ? notesCreate(useSettingsStore.getState().lastColor())
            .then((note) => notesUpdate(note.id, { content: written }))
            .then(() => loadNotes())
        : tasksCreate(task).then(() => loadTasks());

    void work
      .catch((error: unknown) => {
        // Nothing is thrown away silently: the field stays up with the text in
        // it, which is the only copy of what was typed.
        console.error("quick capture: could not save", error);
        setSaving(false);
      })
      .then(() => {
        close();
      });
  };

  return (
    <div className={styles.view}>
      <textarea
        ref={inputRef}
        className={styles.input}
        value={text}
        rows={1}
        spellCheck
        placeholder="Capture a thought…"
        disabled={saving}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          }
          // Escape is handled here rather than in the panel's cascade: this is
          // the only thing on screen, and there is nothing else it could mean.
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      <p className={styles.hint}>
        {text.trimStart().startsWith("[")
          ? "Enter adds a task"
          : "Enter saves a note · start with [ ] for a task"}
      </p>
    </div>
  );
}

/**
 * A line that starts with `[ ]`, `[]` or `- [ ]` is a task, and the rest of it
 * goes through the same quick-entry parser the Tasks tab uses. Anything else is
 * a note, including a line that merely mentions a bracket.
 */
function asTask(written: string): Parameters<typeof tasksCreate>[0] | null {
  const match = /^-?\s*\[\s*\]\s*(.*)$/s.exec(written);
  if (match === null) {
    return null;
  }
  const quick = parseTaskText(match[1] ?? "", new Date());
  if (quick.title === "") {
    return null;
  }
  return {
    title: quick.title,
    priority: quick.priority,
    dueDate: quick.due?.date ?? null,
    dueTime: quick.due?.time ?? null,
    repeat: quick.repeat,
  };
}
