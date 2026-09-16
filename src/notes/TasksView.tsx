import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Flag, Plus, Repeat as RepeatIcon, Text } from "lucide-react";

import { cx } from "../lib/cx";
import type { Task } from "../lib/ipc";
import { dueLabel, dueOf, isDone, SECTION_LABELS, type DueSection } from "../lib/taskMeta";
import { groupTasks } from "../lib/tasks";
import { useNow } from "../lib/useNow";
import { useDockStore } from "../store/dock";
import { useTasksStore } from "../store/tasks";
import { TaskDetails } from "./TaskDetails";
import styles from "./TasksView.module.css";

interface TasksViewProps {
  /**
   * The tab is showing. The view stays mounted while hidden so the two tabs can
   * slide between each other; becoming active starts a new visit.
   */
  active: boolean;
}

/** The box. A button rather than an `<input>`: it carries an icon, not a tick glyph. */
function Checkbox({
  done,
  label,
  onToggle,
}: {
  done: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      // Named for the task it belongs to: on its own, a box says nothing.
      aria-label={label}
      className={styles.box}
      onClick={(event) => {
        // The row opens the details sheet; the box must not do both.
        event.stopPropagation();
        onToggle();
      }}
    >
      {done && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

/**
 * A task's details under its title: when it is due, how often it repeats, and
 * whether there is more written down. Everything here is also in the sheet —
 * this is the glance, not the control.
 */
function Meta({ task, now, overdue }: { task: Task; now: number; overdue: boolean }) {
  const due = dueOf(task);
  if (due === null && task.repeat === null && task.notes.trim() === "") {
    return null;
  }
  return (
    <div className={styles.meta}>
      {due !== null && (
        <span className={cx(styles.due, overdue && styles.overdue)}>
          {dueLabel(due, new Date(now))}
        </span>
      )}
      {task.repeat !== null && <RepeatIcon size={11} strokeWidth={2} aria-label="Repeats" />}
      {task.notes.trim() !== "" && <Text size={11} strokeWidth={2} aria-label="Has notes" />}
    </div>
  );
}

/**
 * The Tasks tab.
 *
 * Tasks are their own records now, so this is a list of them rather than a view
 * assembled out of note text. What that buys, and what this screen is built
 * around: a task can be added without choosing a note to put it in, its details
 * are fields rather than tokens inside a sentence, and completing one is a
 * property of the task instead of an edit to a paragraph somewhere.
 *
 * A tick made during a visit leaves the task where it is, struck through, rather
 * than moving it to Done under the cursor. Coming back to the tab is a new
 * visit, and by then it has settled.
 */
export function TasksView({ active }: TasksViewProps) {
  const tasks = useTasksStore((state) => state.tasks);
  const loaded = useTasksStore((state) => state.loaded);
  const draft = useTasksStore((state) => state.draft);
  const setDraft = useTasksStore((state) => state.setDraft);
  const add = useTasksStore((state) => state.add);
  const tick = useTasksStore((state) => state.tick);
  const detailsId = useTasksStore((state) => state.detailsId);
  const openDetails = useTasksStore((state) => state.openDetails);
  const phase = useDockStore((state) => state.phase);
  const setLock = useDockStore((state) => state.setLock);
  const now = useNow();

  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [tickedHere, setTickedHere] = useState<ReadonlySet<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  // Each time the tab is shown is a new visit: ticks made last time settle into
  // Done. Adjusted while rendering, when `active` changes, so the first frame of
  // the visit is already right.
  const [seenActive, setSeenActive] = useState(active);
  if (active !== seenActive) {
    setSeenActive(active);
    if (active) {
      setTickedHere(new Set());
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
    setLock("tasks", focused);
    return () => {
      setLock("tasks", false);
    };
  }, [focused, setLock]);

  // A hidden tab must not keep the keyboard, or its fields would hold the panel
  // open from off screen.
  useEffect(() => {
    const element = document.activeElement;
    if (!active && element instanceof HTMLElement && rootRef.current?.contains(element)) {
      element.blur();
    }
  }, [active]);

  const sections = useMemo(() => {
    const at = new Date(now);
    // A task ticked during this visit is grouped as if it were still open, so
    // the row under the cursor does not jump to Done the moment it is ticked.
    const asShown = tasks.map((task) =>
      isDone(task) && tickedHere.has(task.id) ? { ...task, doneAt: null } : task,
    );
    return groupTasks(asShown, at);
  }, [tasks, now, tickedHere]);

  const open = sections.filter((section) => section.kind !== "done");
  const done = sections.find((section) => section.kind === "done");
  const hasAny = tasks.length > 0;

  const onTick = (task: Task) => {
    if (!isDone(task)) {
      setTickedHere((current) => new Set(current).add(task.id));
    }
    void tick(task.id);
  };

  const renderRow = (task: Task, kind: DueSection) => {
    const ticked = isDone(task) || tickedHere.has(task.id);
    const isOpen = detailsId === task.id;
    return (
      <li key={task.id} className={styles.item}>
        <div className={styles.row}>
          <Checkbox
            done={ticked}
            label={task.title || "Untitled task"}
            onToggle={() => {
              onTick(task);
            }}
          />
          <button
            type="button"
            className={styles.body}
            // Arrow-key movement and Enter both go through this one control, so
            // a task has a single keyboard path in and out.
            data-task-row=""
            aria-expanded={isOpen}
            onClick={() => {
              openDetails(isOpen ? null : task.id);
            }}
          >
            <span className={cx(styles.title, ticked && styles.ticked)}>
              {task.title || "Untitled task"}
            </span>
            <Meta task={task} now={now} overdue={kind === "overdue" && !ticked} />
          </button>
          {task.priority !== null && (
            <Flag
              size={12}
              strokeWidth={task.priority === "low" ? 1.5 : 2}
              fill={task.priority === "high" ? "currentColor" : "none"}
              className={cx(styles.flag, styles[`priority-${task.priority}`])}
              aria-label={`${task.priority} priority`}
            />
          )}
        </div>
        {isOpen && (
          <TaskDetails
            task={task}
            onFocusChange={setFocused}
            onClose={() => {
              openDetails(null);
            }}
          />
        )}
      </li>
    );
  };

  return (
    <div ref={rootRef} className={styles.tasks} role="tabpanel" aria-label="Tasks">
      <div className={styles.add}>
        <span className={styles.addIcon} aria-hidden="true">
          <Plus size={14} strokeWidth={2} />
        </span>
        <input
          ref={fieldRef}
          type="text"
          className={styles.field}
          value={draft}
          aria-label="Add a task"
          placeholder="Add a task"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              // The field keeps focus, so a list can be typed in one go.
              void add();
            }
          }}
        />
      </div>

      {open.length === 0 && !hasAny && loaded ? (
        <div className={styles.empty}>
          <p className={styles.headline}>Nothing to do</p>
          <p className={styles.hint}>Type above to add your first task.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {open.length === 0 && hasAny && (
            <p className={styles.clear}>All clear. Nothing is due.</p>
          )}
          {open.map((section) => (
            <section key={section.kind} className={styles.group}>
              <h3 className={cx(styles.heading, section.kind === "overdue" && styles.overdue)}>
                {SECTION_LABELS[section.kind]}
                <span className={styles.count}>{section.tasks.length}</span>
              </h3>
              <ul className={styles.rows}>
                {section.tasks.map((task) => renderRow(task, section.kind))}
              </ul>
            </section>
          ))}

          {done !== undefined && (
            <section className={styles.group}>
              <button
                type="button"
                className={styles.doneToggle}
                aria-expanded={showDone}
                onClick={() => {
                  setShowDone((value) => !value);
                }}
              >
                <ChevronRight
                  size={12}
                  strokeWidth={2}
                  className={cx(styles.chevron, showDone && styles.chevronOpen)}
                  aria-hidden="true"
                />
                {SECTION_LABELS.done}
                <span className={styles.count}>{done.tasks.length}</span>
              </button>
              {showDone && (
                <ul className={styles.rows}>
                  {done.tasks.map((task) => renderRow(task, "done"))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
