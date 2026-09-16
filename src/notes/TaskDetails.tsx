import { useState, type ReactNode } from "react";
import { CalendarDays, Flag, Repeat as RepeatIcon, Text, Trash2, X } from "lucide-react";

import { cx } from "../lib/cx";
import type { Task, TaskPatch } from "../lib/ipc";
import {
  addDays,
  dateKey,
  dueLabel,
  dueOf,
  priorityLabel,
  REPEATS,
  repeatLabel,
  type Priority,
  type Repeat,
} from "../lib/taskMeta";
import { useNow } from "../lib/useNow";
import { useTasksStore } from "../store/tasks";
import styles from "./TaskDetails.module.css";

interface TaskDetailsProps {
  task: Task;
  onClose: () => void;
  /** Told when a field here has the keyboard, so the panel stays open. */
  onFocusChange: (focused: boolean) => void;
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

/**
 * A flag in the priority's colour, drawn with more weight the higher it is. The
 * weight is not decoration left over from before the colour: it is what still
 * tells the three apart in a monochrome screenshot or to a colour-blind reader.
 */
function PriorityFlag({ priority }: { priority: Priority }) {
  return (
    <Flag
      size={12}
      strokeWidth={priority === "low" ? 1.5 : 2}
      fill={priority === "high" ? "currentColor" : "none"}
      className={cx(styles.flag, styles[`priority-${priority}`])}
      aria-hidden="true"
    />
  );
}

/**
 * None first, then the ramp upwards. Read left to right as a row of choices,
 * ranking order would put High between None and Medium, which is not an order
 * anything is in.
 */
const PRIORITY_CHOICES: (Priority | null)[] = [null, "low", "medium", "high"];

/**
 * Everything about one task that its row has no space for: title, a notes field,
 * priority, when it is due, whether it repeats — and deleting it.
 *
 * Every control writes a field straight to the database. Until v2 this sheet
 * rewrote a line of text inside a note, so the details had to be parsed back out
 * of a sentence on the way in, and any of them could be broken by editing the
 * words around them.
 */
export function TaskDetails({ task, onClose, onFocusChange }: TaskDetailsProps) {
  const patch = useTasksStore((state) => state.patch);
  const setTitle = useTasksStore((state) => state.setTitle);
  const remove = useTasksStore((state) => state.remove);
  const now = useNow();

  const [title, setTitleDraft] = useState(task.title);
  const [notes, setNotesDraft] = useState(task.notes);
  // Every save comes back as a new task, so the sheet follows a change made
  // elsewhere without stamping on what is half-typed here.
  const [seen, setSeen] = useState(task);
  if (task !== seen) {
    setSeen(task);
    if (task.title !== seen.title) {
      setTitleDraft(task.title);
    }
    if (task.notes !== seen.notes) {
      setNotesDraft(task.notes);
    }
  }

  const due = dueOf(task);
  const save = (changes: TaskPatch) => {
    void patch(task.id, changes);
  };

  const today = dateKey(new Date(now));
  const quickDates = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(today, 7) },
  ];

  const summary = [
    task.priority === null ? "" : `${priorityLabel(task.priority)} priority`,
    due === null ? "" : dueLabel(due, new Date(now)),
    task.repeat === null ? "" : `Repeats ${task.repeat}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");

  const fieldProps = {
    onFocus: () => {
      onFocusChange(true);
    },
    onBlur: () => {
      onFocusChange(false);
    },
  };

  return (
    <div className={styles.sheet}>
      <input
        type="text"
        className={styles.title}
        aria-label="Task"
        value={title}
        spellCheck={false}
        onFocus={() => {
          onFocusChange(true);
        }}
        onChange={(event) => {
          setTitleDraft(event.target.value);
        }}
        onBlur={() => {
          onFocusChange(false);
          void setTitle(task.id, title);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void setTitle(task.id, title);
          }
        }}
      />

      <Section icon={<Flag size={12} strokeWidth={2} />} label="Priority">
        <div className={styles.segments}>
          {PRIORITY_CHOICES.map((priority) => (
            <button
              key={priority ?? "none"}
              type="button"
              className={cx(styles.segment, task.priority === priority && styles.selected)}
              aria-pressed={task.priority === priority}
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
              className={cx(styles.chip, due?.date === quick.date && styles.selected)}
              aria-pressed={due?.date === quick.date}
              onClick={() => {
                save({ dueDate: quick.date });
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
            value={due?.date ?? ""}
            {...fieldProps}
            onChange={(event) => {
              const date = event.target.value;
              save({ dueDate: date === "" ? null : date });
            }}
          />
          <input
            type="time"
            className={cx(styles.input, styles.time)}
            aria-label="Due time"
            value={due?.time ?? ""}
            disabled={due === null}
            {...fieldProps}
            onChange={(event) => {
              const time = event.target.value;
              save({ dueTime: time === "" ? null : time.slice(0, 5) });
            }}
          />
          {due !== null && (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear due date and repeat"
              title="Clear due date and repeat"
              onClick={() => {
                save({ dueDate: null, repeat: null });
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
              className={cx(styles.chip, task.repeat === repeat && styles.selected)}
              aria-pressed={task.repeat === repeat}
              onClick={() => {
                save({ repeat });
              }}
            >
              {repeat === null ? "Never" : repeatLabel(repeat)}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<Text size={12} strokeWidth={2} />} label="Notes">
        <textarea
          className={styles.notes}
          aria-label="Task notes"
          value={notes}
          rows={2}
          placeholder="Anything worth writing down"
          onFocus={() => {
            onFocusChange(true);
          }}
          onChange={(event) => {
            setNotesDraft(event.target.value);
          }}
          onBlur={() => {
            onFocusChange(false);
            if (notes !== task.notes) {
              save({ notes });
            }
          }}
        />
      </Section>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.delete}
          aria-label="Delete task"
          title="Delete task"
          onClick={() => {
            void remove(task.id);
          }}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
        <span className={styles.summary}>{summary === "" ? "No details yet" : summary}</span>
        <button type="button" className={styles.done} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
