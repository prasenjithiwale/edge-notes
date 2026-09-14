import { useState, type ReactNode } from "react";
import { CalendarDays, Flag, Repeat as RepeatIcon, X } from "lucide-react";

import { cx } from "../lib/cx";
import {
  addDays,
  dateKey,
  dueLabel,
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
import { useNow } from "../lib/useNow";
import { useNotesStore } from "../store/notes";
import styles from "./TaskDetails.module.css";

interface TaskDetailsProps {
  task: Task;
  onClose: () => void;
}

function Section({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.section} role="group" aria-label={label}>
      <div className={styles.caption} aria-hidden="true">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

/** A flag drawn with more weight the higher the priority. */
function PriorityFlag({ priority }: { priority: Priority }) {
  return (
    <Flag
      size={12}
      strokeWidth={priority === "low" ? 1.5 : 2}
      fill={priority === "high" ? "currentColor" : "none"}
      className={cx(styles.flag, priority === "low" && styles.flagLow)}
      aria-hidden="true"
    />
  );
}

/**
 * Priority, due date and time, and repeat for one task, set without typing the
 * tokens. A raised sheet under the task: the title large at the top, then one
 * section per detail, each a row of chips a click away, and a one-line summary of
 * what is set beside Done. Every change is written straight into the note's
 * line; the title commits when its field is left or Enter is pressed, so a
 * half-typed title never reaches the note.
 */
export function TaskDetails({ task, onClose }: TaskDetailsProps) {
  const setTaskLine = useNotesStore((state) => state.setTaskLine);
  const now = useNow();
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

  const today = dateKey(new Date(now));
  const quickDates = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(today, 7) },
  ];
  const setDate = (date: string) => {
    save({ due: { date, time: meta.due?.time ?? null } });
  };

  const summary = [
    meta.priority === null ? null : `${priorityLabel(meta.priority)} priority`,
    meta.due === null ? null : dueLabel(meta.due, new Date(now)),
    meta.repeat === null ? null : `Repeats ${repeatLabel(meta.repeat).toLowerCase()}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <div className={styles.sheet} role="group" aria-label="Task details">
      <input
        type="text"
        className={styles.title}
        value={title}
        aria-label="Task"
        placeholder="Task"
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

      <Section icon={<Flag size={12} strokeWidth={2} />} label="Priority">
        <div className={styles.segments}>
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
              {priority !== null && <PriorityFlag priority={priority} />}
              {priority === null ? "None" : priorityLabel(priority)}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<CalendarDays size={12} strokeWidth={2} />} label="Due">
        <div className={styles.chips}>
          {quickDates.map((quick) => (
            <button
              key={quick.label}
              type="button"
              className={cx(styles.chip, meta.due?.date === quick.date && styles.selected)}
              aria-pressed={meta.due?.date === quick.date}
              onClick={() => {
                setDate(quick.date);
              }}
            >
              {quick.label}
            </button>
          ))}
        </div>
        <div className={styles.when}>
          <input
            type="date"
            className={cx(styles.input, styles.date)}
            aria-label="Due date"
            value={meta.due?.date ?? ""}
            onChange={(event) => {
              const date = event.target.value;
              if (date === "") {
                save({ due: null });
              } else {
                setDate(date);
              }
            }}
          />
          <input
            type="time"
            className={cx(styles.input, styles.time)}
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
          {meta.due !== null && (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear due date"
              title="Clear due date"
              onClick={() => {
                save({ due: null, repeat: null });
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </Section>

      <Section icon={<RepeatIcon size={12} strokeWidth={2} />} label="Repeat">
        <div className={styles.chips}>
          {([null, ...REPEATS] as (Repeat | null)[]).map((repeat) => (
            <button
              key={repeat ?? "never"}
              type="button"
              className={cx(styles.chip, meta.repeat === repeat && styles.selected)}
              aria-pressed={meta.repeat === repeat}
              onClick={() => {
                save({ repeat });
              }}
            >
              {repeat === null ? "Never" : repeatLabel(repeat)}
            </button>
          ))}
        </div>
      </Section>

      <div className={styles.footer}>
        <span className={styles.summary}>{summary === "" ? "No details yet" : summary}</span>
        <button type="button" className={styles.done} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
