import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
} from "react";
import { ChevronRight, SlidersHorizontal } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import type { Line } from "../lib/markdown";
import { compareTasks, dueSection, SECTION_LABELS, type DueSection } from "../lib/taskMeta";
import { collectTasks, type Task, type TaskGroup } from "../lib/tasks";
import { useNow } from "../lib/useNow";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { LineRow } from "./NoteText";
import { TaskDetails } from "./TaskDetails";
import styles from "./TodoView.module.css";

interface TodoViewProps {
  /**
   * The tab is showing. The view stays mounted while hidden so the two tabs can
   * slide between each other; becoming active starts a new visit.
   */
  active: boolean;
  /** Open a note in the Notes tab's editor. */
  onOpenNote: (id: string) => void;
}

const SECTIONS: readonly DueSection[] = ["overdue", "today", "upcoming", "none"];

interface Row {
  task: Task;
  group: TaskGroup;
}

function taskKey(task: Task): string {
  return `${task.noteId}:${String(task.line)}`;
}

function asLine(task: Task): Line {
  return {
    kind: "task",
    indent: "",
    prefix: "- [ ] ",
    text: task.text,
    checked: task.checked,
    number: 0,
    marker: "-",
  };
}

/**
 * Every checklist item from every note, in sections by due date — Overdue,
 * Today, Upcoming, No date — highest priority first within each. Ticking here
 * edits the note; "Add a task" appends to the note titled To-Do; the details
 * button sets a task's priority, date, time and repeat.
 *
 * The view holds still while it is in use: a task ticked here stays in place,
 * struck through, until the tab is left or the panel collapses, and tasks that
 * tie keep the note order they had when the tab opened — ticking edits a note,
 * which would otherwise reshuffle them under the cursor.
 */
export function TodoView({ active, onOpenNote }: TodoViewProps) {
  const notes = useNotesStore((state) => state.notes);
  const draft = useNotesStore((state) => state.taskDraft);
  const setDraft = useNotesStore((state) => state.setTaskDraft);
  const addTask = useNotesStore((state) => state.addTask);
  const toggleTask = useNotesStore((state) => state.toggleTask);
  const phase = useDockStore((state) => state.phase);
  const setLock = useDockStore((state) => state.setLock);
  const now = useNow();

  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [tickedHere, setTickedHere] = useState<ReadonlySet<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  // The task whose details sheet is open, and the section it was in when it
  // opened: it stays there while the sheet is open, even if its new date belongs
  // elsewhere, so the sheet is not torn down and rebuilt under the cursor.
  const [details, setDetails] = useState<{ key: string; section: DueSection } | null>(null);

  const groups = useMemo(() => collectTasks(notes), [notes]);
  const [order, setOrder] = useState(() => groups.map((group) => group.note.id));

  // Each time the tab is shown is a new visit: ticks made last time settle into
  // Done, and the note order is taken afresh. Adjusted while rendering, when
  // `active` changes, so the first frame of the visit is already right.
  const [seenActive, setSeenActive] = useState(active);
  if (active !== seenActive) {
    setSeenActive(active);
    if (active) {
      setOrder(groups.map((group) => group.note.id));
      setTickedHere(new Set());
      setDetails(null);
    }
  }

  // A collapse is the end of a visit too.
  const [seenPhase, setSeenPhase] = useState(phase);
  if (phase !== seenPhase) {
    setSeenPhase(phase);
    if (phase === "collapsed") {
      setTickedHere(new Set());
    }
  }

  // Held while typing a task or its details, as the search field holds it
  // (brief 6.3). Derived from state, never acquired in one handler and released
  // in another.
  useEffect(() => {
    setLock("todo", focused);
    return () => {
      setLock("todo", false);
    };
  }, [focused, setLock]);

  // A hidden tab must not keep the keyboard, or its fields would hold the panel
  // open from off screen.
  useEffect(() => {
    const focusedElement = document.activeElement;
    if (!active && focusedElement instanceof HTMLElement && rootRef.current?.contains(focusedElement)) {
      focusedElement.blur();
    }
  }, [active]);

  const { sections, done } = useMemo(() => {
    const rank = new Map(order.map((id, index) => [id, index]));
    const at = new Date(now);
    const bySection = new Map<DueSection, Row[]>(SECTIONS.map((section) => [section, []]));
    const finished: Row[] = [];

    for (const group of groups) {
      for (const task of group.tasks) {
        const row = { task, group };
        const key = taskKey(task);
        if (task.checked && !tickedHere.has(key)) {
          finished.push(row);
        } else {
          const section = details?.key === key ? details.section : dueSection(task.meta.due, at);
          bySection.get(section)?.push(row);
        }
      }
    }

    // Notes that did not exist when the tab opened (the To-Do note, the first
    // time a task is added) rank first, where the new task can be seen.
    const noteRank = (row: Row) => rank.get(row.task.noteId) ?? -1;
    for (const rows of bySection.values()) {
      rows.sort(
        (a, b) =>
          compareTasks(a.task.meta, b.task.meta) ||
          noteRank(a) - noteRank(b) ||
          a.task.line - b.task.line,
      );
    }
    return { sections: bySection, done: finished };
  }, [groups, order, tickedHere, now, details]);

  const hasAnyTask = groups.length > 0;
  const openCount = SECTIONS.reduce(
    (count, section) => count + (sections.get(section)?.length ?? 0),
    0,
  );

  const tick = (task: Task) => {
    if (!task.checked) {
      setTickedHere((current) => new Set(current).add(taskKey(task)));
    }
    toggleTask(task.noteId, task.line);
  };

  const renderRow = ({ task, group }: Row, inDone: boolean, section: DueSection | null) => {
    const key = taskKey(task);
    const open = details?.key === key;
    return (
      <div key={key} className={styles.item}>
        <div className={styles.row}>
          <LineRow
            line={asLine(task)}
            wrap
            className={styles.task}
            onToggle={() => {
              tick(task);
            }}
          />
          {!inDone && (
            <IconButton
              label="Task details"
              className={styles.detailsButton}
              pressed={open}
              onClick={() => {
                setDetails(open || section === null ? null : { key, section });
              }}
            >
              <SlidersHorizontal size={14} strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
        <button
          type="button"
          className={styles.source}
          title="Open note"
          onClick={() => {
            onOpenNote(group.note.id);
          }}
        >
          <span
            className={styles.dot}
            style={{ "--dot-bg": `var(--note-${group.note.color}-bg)` } as CSSProperties}
            aria-hidden="true"
          />
          <span className={styles.sourceName}>{group.title}</span>
        </button>
        {open && (
          <TaskDetails
            task={task}
            onClose={() => {
              setDetails(null);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={styles.todo}
      role="tabpanel"
      aria-label="To-Do"
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event: FocusEvent) => {
        // Moving between fields inside the view is not leaving it.
        const next = event.relatedTarget;
        if (!(next instanceof Node && rootRef.current?.contains(next))) {
          setFocused(false);
        }
      }}
    >
      <form
        className={styles.add}
        onSubmit={(event) => {
          event.preventDefault();
          void addTask();
        }}
      >
        <input
          type="text"
          className={styles.field}
          value={draft}
          aria-label="Add a task"
          placeholder="Add a task"
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      </form>

      <div className={styles.list}>
        {!hasAnyTask && (
          <div className={styles.empty}>
            <p className={styles.headline}>Nothing to do</p>
            <p className={styles.message}>Add a task above, or a checklist to any note.</p>
          </div>
        )}
        {hasAnyTask && openCount === 0 && (
          <p className={cx(styles.message, styles.allDone)}>All done</p>
        )}

        {SECTIONS.map((section) => {
          const rows = sections.get(section) ?? [];
          if (rows.length === 0) {
            return null;
          }
          return (
            <section key={section} className={styles.group} aria-label={SECTION_LABELS[section]}>
              <h2 className={cx(styles.heading, section === "overdue" && styles.overdue)}>
                {SECTION_LABELS[section]}
              </h2>
              {rows.map((row) => renderRow(row, false, section))}
            </section>
          );
        })}

        {done.length > 0 && (
          <section className={styles.group}>
            <button
              type="button"
              className={styles.doneToggle}
              aria-expanded={showDone}
              onClick={() => {
                setShowDone((open) => !open);
              }}
            >
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className={cx(styles.chevron, showDone && styles.chevronOpen)}
              />
              {`Done (${String(done.length)})`}
            </button>
            {showDone && done.map((row) => renderRow(row, true, null))}
          </section>
        )}
      </div>
    </div>
  );
}
