import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Flag, Plus, Repeat as RepeatIcon, Text } from "lucide-react";

import { cx } from "../lib/cx";
import type { Task } from "../lib/ipc";
import {
  dueLabel,
  dueOf,
  hasQuickDetails,
  isDone,
  parseTaskText,
  priorityLabel,
  repeatLabel,
  SECTION_LABELS,
  type DueSection,
} from "../lib/taskMeta";
import { filterTasks, groupTasks } from "../lib/tasks";
import { useNow } from "../lib/useNow";
import { useDockStore } from "../store/dock";
import { useTasksStore } from "../store/tasks";
import { TaskDetails } from "./TaskDetails";
import styles from "./TasksView.module.css";

interface TasksViewProps {
  /**
   * The tab is showing. The view stays mounted while hidden so the tabs can
   * slide between each other; becoming active starts a new visit.
   */
  active: boolean;
  /** The panel's search box, which searches whichever tab is in front. */
  query: string;
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
      <Check className={styles.tick} size={11} strokeWidth={3.5} aria-hidden="true" />
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
    <span className={styles.meta}>
      {due !== null && (
        <span className={cx(styles.due, overdue && styles.overdue)}>
          {dueLabel(due, new Date(now))}
        </span>
      )}
      {task.repeat !== null && (
        <RepeatIcon size={11} strokeWidth={2} aria-label={`Repeats ${repeatLabel(task.repeat)}`} />
      )}
      {task.notes.trim() !== "" && <Text size={11} strokeWidth={2} aria-label="Has notes" />}
    </span>
  );
}

/**
 * What quick entry has found in the add field, as it is typed.
 *
 * The tokens have always worked and almost nobody knew: a feature you have to
 * read the changelog to find is not a feature. Showing what will be set the
 * moment it parses teaches the format by using it, and doubles as the
 * confirmation that `@fri` was understood as Friday.
 */
function QuickPreview({ draft, now }: { draft: string; now: number }) {
  const quick = useMemo(() => parseTaskText(draft, new Date(now)), [draft, now]);
  if (!hasQuickDetails(quick)) {
    return null;
  }
  return (
    <div className={styles.preview} role="status">
      {quick.priority !== null && (
        <span className={cx(styles.previewChip, styles[`priority-${quick.priority}`])}>
          <Flag
            size={10}
            strokeWidth={quick.priority === "low" ? 1.5 : 2}
            fill={quick.priority === "high" ? "currentColor" : "none"}
            aria-hidden="true"
          />
          {priorityLabel(quick.priority)}
        </span>
      )}
      {quick.due !== null && (
        <span className={styles.previewChip}>{dueLabel(quick.due, new Date(now))}</span>
      )}
      {quick.repeat !== null && (
        <span className={styles.previewChip}>
          <RepeatIcon size={10} strokeWidth={2} aria-hidden="true" />
          {repeatLabel(quick.repeat)}
        </span>
      )}
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
export function TasksView({ active, query }: TasksViewProps) {
  const tasks = useTasksStore((state) => state.tasks);
  const loaded = useTasksStore((state) => state.loaded);
  const draft = useTasksStore((state) => state.draft);
  const setDraft = useTasksStore((state) => state.setDraft);
  const add = useTasksStore((state) => state.add);
  const tick = useTasksStore((state) => state.tick);
  const detailsId = useTasksStore((state) => state.detailsId);
  const openDetails = useTasksStore((state) => state.openDetails);
  const collapsed = useTasksStore((state) => state.collapsed);
  const toggleSection = useTasksStore((state) => state.toggleSection);
  const phase = useDockStore((state) => state.phase);
  const setLock = useDockStore((state) => state.setLock);
  const now = useNow();

  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [tickedHere, setTickedHere] = useState<ReadonlySet<string>>(new Set());

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

  // A sheet is a task's own screen, and opening one on the last row would
  // otherwise unfold it below the fold, where nothing says it is there.
  useEffect(() => {
    if (detailsId === null || !active) {
      return;
    }
    const sheet = rootRef.current?.querySelector<HTMLElement>(`[data-sheet="${detailsId}"]`);
    // Feature-detected: jsdom has no layout, so it has no `scrollIntoView`.
    if (typeof sheet?.scrollIntoView === "function") {
      sheet.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [detailsId, active]);

  const searching = query.trim() !== "";
  const sections = useMemo(() => {
    const at = new Date(now);
    // A task ticked during this visit is grouped as if it were still open, so
    // the row under the cursor does not jump to Done the moment it is ticked.
    const asShown = filterTasks(tasks, query).map((task) =>
      isDone(task) && tickedHere.has(task.id) ? { ...task, doneAt: null } : task,
    );
    return groupTasks(asShown, at);
  }, [tasks, query, now, tickedHere]);

  const hasAny = tasks.length > 0;
  const nothingMatches = sections.length === 0;
  // Everything is done, but there are still tasks: not the same as having none,
  // and not the same as a search that found nothing.
  const allClear = !searching && sections.every((section) => section.kind === "done");

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
        <div className={cx(styles.row, isOpen && styles.rowOpen)}>
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
            data-id={task.id}
            aria-expanded={isOpen}
            onClick={() => {
              openDetails(isOpen ? null : task.id);
            }}
          >
            <span className={styles.line}>
              {task.priority !== null && (
                <Flag
                  size={11}
                  strokeWidth={task.priority === "low" ? 1.5 : 2}
                  fill={task.priority === "high" ? "currentColor" : "none"}
                  className={cx(styles.flag, styles[`priority-${task.priority}`])}
                  aria-label={`${task.priority} priority`}
                />
              )}
              <span className={cx(styles.title, ticked && styles.ticked)}>
                {task.title || "Untitled task"}
              </span>
            </span>
            <Meta task={task} now={now} overdue={kind === "overdue" && !ticked} />
          </button>
          <ChevronRight
            size={13}
            strokeWidth={2}
            className={cx(styles.disclosure, isOpen && styles.disclosureOpen)}
            aria-hidden="true"
          />
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
      <div className={styles.entry}>
        <div className={styles.add}>
          <span className={styles.addIcon} aria-hidden="true">
            <Plus size={14} strokeWidth={2} />
          </span>
          <input
            type="text"
            className={styles.field}
            data-task-add=""
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
        <QuickPreview draft={draft} now={now} />
      </div>

      {!loaded ? null : nothingMatches && searching ? (
        <div className={styles.empty}>
          <p className={styles.headline}>No tasks match “{query.trim()}”</p>
        </div>
      ) : !hasAny ? (
        <div className={styles.empty}>
          <p className={styles.headline}>Nothing to do</p>
          <p className={styles.hint}>
            Type above to add your first task. Add <code>@tomorrow</code>, <code>2pm</code> or{" "}
            <code>!!!</code> and it will fill the details in.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {allClear && <p className={styles.clear}>All clear. Nothing is due.</p>}
          {sections.map((section) => {
            const folded = collapsed.has(section.kind);
            return (
              <section key={section.kind} className={styles.group}>
                <h3 className={styles.headingRow}>
                  <button
                    type="button"
                    className={cx(
                      styles.heading,
                      section.kind === "overdue" && styles.overdue,
                    )}
                    aria-expanded={!folded}
                    onClick={() => {
                      toggleSection(section.kind);
                    }}
                  >
                    <ChevronRight
                      size={11}
                      strokeWidth={2.5}
                      className={cx(styles.chevron, !folded && styles.chevronOpen)}
                      aria-hidden="true"
                    />
                    {SECTION_LABELS[section.kind]}
                    <span className={styles.count}>{section.tasks.length}</span>
                  </button>
                </h3>
                {!folded && (
                  <ul className={styles.rows}>
                    {section.tasks.map((task) => renderRow(task, section.kind))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
