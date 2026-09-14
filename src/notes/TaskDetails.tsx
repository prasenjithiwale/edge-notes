import { useState } from "react";

import { cx } from "../lib/cx";
import {
  dateKey,
  formatTaskText,
  PRIORITIES,
  priorityLabel,
  REPEATS,
  repeatLabel,
  type Priority,
  type Repeat,
  type TaskMeta,
} from "../lib/taskMeta";
import type { Task } from "../lib/tasks";
import { useNotesStore } from "../store/notes";
import styles from "./TaskDetails.module.css";

interface TaskDetailsProps {
  task: Task;
  onClose: () => void;
}

/**
 * Priority, due date and time, and repeat for one task, set without typing the
 * tokens. Every change is written straight into the note's line. The title is
 * edited here too, committed when the field is left or Enter is pressed, so a
 * half-typed title never reaches the note.
 */
export function TaskDetails({ task, onClose }: TaskDetailsProps) {
  const setTaskLine = useNotesStore((state) => state.setTaskLine);
  const { meta } = task;
  const [title, setTitle] = useState(meta.title);
  // Every save rewrites the line, so the sheet stays mounted (a date field keeps
  // focus) and follows a title changed from elsewhere as it arrives.
  const [seenTitle, setSeenTitle] = useState(meta.title);
  if (meta.title !== seenTitle) {
    setSeenTitle(meta.title);
    setTitle(meta.title);
  }

  const save = (changes: Partial<TaskMeta>) => {
    setTaskLine(task.noteId, task.line, formatTaskText({ ...meta, ...changes }));
  };

  const commitTitle = () => {
    if (title.trim() !== "" && title.trim() !== meta.title) {
      save({ title: title.trim() });
    }
  };

  return (
    <div className={styles.details} role="group" aria-label="Task details">
      <input
        type="text"
        className={styles.title}
        value={title}
        aria-label="Task"
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitTitle();
          }
        }}
      />

      <div className={styles.field}>
        <span className={styles.label} id={`priority-${task.noteId}-${String(task.line)}`}>
          Priority
        </span>
        <div
          className={styles.segments}
          role="group"
          aria-labelledby={`priority-${task.noteId}-${String(task.line)}`}
        >
          {([null, ...PRIORITIES] as (Priority | null)[]).map((priority) => (
            <button
              key={priority ?? "none"}
              type="button"
              className={cx(styles.segment, meta.priority === priority && styles.selected)}
              aria-pressed={meta.priority === priority}
              onClick={() => {
                save({ priority });
              }}
            >
              {priority === null ? "None" : priorityLabel(priority)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`date-${task.noteId}-${String(task.line)}`}>
          Due
        </label>
        <div className={styles.inline}>
          <input
            id={`date-${task.noteId}-${String(task.line)}`}
            type="date"
            className={styles.input}
            value={meta.due?.date ?? ""}
            onChange={(event) => {
              const date = event.target.value;
              save({ due: date === "" ? null : { date, time: meta.due?.time ?? null } });
            }}
          />
          <input
            type="time"
            className={styles.input}
            aria-label="Due time"
            value={meta.due?.time ?? ""}
            disabled={meta.due === null}
            onChange={(event) => {
              const time = event.target.value;
              if (meta.due !== null) {
                save({ due: { date: meta.due.date, time: time === "" ? null : time.slice(0, 5) } });
              }
            }}
          />
        </div>
        <div className={styles.quick}>
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              save({ due: { date: dateKey(new Date()), time: meta.due?.time ?? null } });
            }}
          >
            Today
          </button>
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              save({ due: { date: dateKey(tomorrow), time: meta.due?.time ?? null } });
            }}
          >
            Tomorrow
          </button>
          {meta.due !== null && (
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                save({ due: null, repeat: null });
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`repeat-${task.noteId}-${String(task.line)}`}>
          Repeat
        </label>
        <select
          id={`repeat-${task.noteId}-${String(task.line)}`}
          className={styles.input}
          aria-label="Repeat"
          value={meta.repeat ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            save({ repeat: value === "" ? null : (value as Repeat) });
          }}
        >
          <option value="">Never</option>
          {REPEATS.map((repeat) => (
            <option key={repeat} value={repeat}>
              {repeatLabel(repeat)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.done} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
