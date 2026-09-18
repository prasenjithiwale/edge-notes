import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Flag, Plus, Repeat as RepeatIcon, Text, X } from "lucide-react";

import { cx } from "../lib/cx";
import type { Status, Task } from "../lib/ipc";
import {
  CLOSED_SECTIONS,
  dueLabel,
  dueOf,
  dueSection,
  hasQuickDetails,
  isCancelled,
  isClosed,
  isInProgress,
  parseTaskText,
  priorityLabel,
  repeatLabel,
  SECTION_LABELS,
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

/**
 * The box. A button rather than an `<input>`: it carries an icon, not a tick
 * glyph, and it now has four states rather than two.
 *
 * It still does one thing — finish this, or unfinish it — because that is the
 * press people make dozens of times a day and it should not become a menu. The
 * other two statuses are *shown* here and *set* in the sheet: a half-filled ring
 * for a task in progress, a struck circle for one that was cancelled. In
 * progress is `aria-checked="mixed"`, which is exactly what a three-state
 * checkbox says, and the cancelled box is labelled rather than left to the
 * shape.
 */
function Checkbox({
  status,
  label,
  onToggle,
}: {
  status: Status;
  label: string;
  onToggle: () => void;
}) {
  const done = status === "done";
  const cancelled = status === "cancelled";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={status === "in_progress" ? "mixed" : done}
      // Named for the task it belongs to: on its own, a box says nothing.
      aria-label={cancelled ? `${label} (cancelled)` : label}
      className={cx(
        styles.box,
        status === "in_progress" && styles.boxDoing,
        cancelled && styles.boxCancelled,
      )}
      onClick={(event) => {
        // The row opens the details sheet; the box must not do both.
        event.stopPropagation();
        onToggle();
      }}
    >
      {cancelled ? (
        <X className={styles.tick} size={10} strokeWidth={3} aria-hidden="true" />
      ) : (
        <Check className={styles.tick} size={11} strokeWidth={3.5} aria-hidden="true" />
      )}
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
 * A task has a status rather than a tick: open, in progress, done or cancelled.
 * The box still finishes one, because that is the press people make all day; the
 * other two are set in the sheet, shown in the box's shape, and used to group
 * the list — In progress at the top, Cancelled at the bottom beside Done.
 *
 * A status changed during a visit leaves the row where it is rather than moving
 * it under the cursor. Coming back to the tab is a new visit, and by then it has
 * settled.
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
   /**
   * Rows *ticked* during this visit, against the status they had when it
   * happened.
   *
   * A ticked row is grouped by the status it was holding rather than the one it
   * has now, so the box you just pressed does not throw the row into Done from
   * under your finger. Which status it *was* is what is remembered rather than a
   * bare "this moved": a task ticked while in progress belongs back in In
   * progress for the rest of the visit, and anything less specific would still
   * move it.
   *
   * Only the box. A status chosen in the sheet is not a press that needs
   * protecting from its own consequences — it is an answer to "what is happening
   * with this", and holding the row made the list disagree with the sheet
   * sitting open inside it until the tab was left and come back to. Reported by
   * the owner on 18 Sep 2026: cancelling a task from its sheet left it under In
   * progress.
   */
  const [tickedHere, setTickedHere] = useState<ReadonlyMap<string, Status>>(new Map());

  // Each time the tab is shown is a new visit: what was ticked last time settles
  // into Done. Adjusted while rendering, when `active` changes, so the first
  // frame of the visit is already right.
  const [seenActive, setSeenActive] = useState(active);
  if (active !== seenActive) {
    setSeenActive(active);
    if (active) {
      setTickedHere(new Map());
    }
  }

  // A collapse is the end of a visit too.
  const [seenPhase, setSeenPhase] = useState(phase);
  if (phase !== seenPhase) {
    setSeenPhase(phase);
    if (phase === "collapsed") {
      setTickedHere(new Map());
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

  /**
   * The stored task behind a row, by id.
   *
   * A row held in place is grouped from a copy with its `doneAt` cleared, and
   * that copy cannot be asked whether the task is done: it says "no" precisely
   * because it is being held where it was. Asking it anyway is what made a
   * ticked task impossible to untick — the box stayed filled whatever the store
   * said, so the next press read as a fresh tick. The copy decides one thing
   * only, which is the section the row is in; everything drawn in the row comes
   * from here.
   */
  const stored = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  // A sheet is a task's own screen, and opening one on the last row would
  // otherwise unfold it below the fold, where nothing says it is there.
  //
  // Keyed on the status as well as the task, because a status set in the sheet
  // moves the row to another section at once and the sheet goes with it: without
  // this, choosing "In progress" would carry the sheet to the top of the list and
  // leave the reader looking at where it used to be.
  const openStatus = detailsId === null ? null : (stored.get(detailsId)?.status ?? null);
  useEffect(() => {
    if (detailsId === null || !active) {
      return;
    }
    const sheet = rootRef.current?.querySelector<HTMLElement>(`[data-sheet="${detailsId}"]`);
    // Feature-detected: jsdom has no layout, so it has no `scrollIntoView`.
    if (typeof sheet?.scrollIntoView === "function") {
      sheet.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [detailsId, openStatus, active]);

  const searching = query.trim() !== "";
  const sections = useMemo(() => {
    const at = new Date(now);
    // A task ticked during this visit is grouped as the status it had, so the
    // row under the cursor stays where the cursor is.
    const asShown = filterTasks(tasks, query).map((task) => {
      const held = tickedHere.get(task.id);
      if (held === undefined || held === task.status) {
        return task;
      }
      // An open status has no closing time, and `groupTasks` reads that time to
      // decide what has aged out of Done.
      return { ...task, status: held, doneAt: held === "done" || held === "cancelled" ? task.doneAt : null };
    });
    return groupTasks(asShown, at);
  }, [tasks, query, now, tickedHere]);

  const hasAny = tasks.length > 0;
  const nothingMatches = sections.length === 0;
  // Everything is closed, but there are still tasks: not the same as having
  // none, and not the same as a search that found nothing.
  const allClear =
    !searching && sections.every((section) => CLOSED_SECTIONS.includes(section.kind));

  /** Remember where a ticked row was, for the rest of the visit. */
  const onTick = (task: Task) => {
    setTickedHere((current) =>
      current.has(task.id) ? current : new Map(current).set(task.id, task.status),
    );
    void tick(task.id);
  };

  const renderRow = (shown: Task) => {
    const task = stored.get(shown.id) ?? shown;
    const closed = isClosed(task);
    const isOpen = detailsId === task.id;
    // Asked of the date rather than of the section the row is drawn in: a task
    // being worked on is listed under In progress and is still late if it is.
    const overdue = !closed && dueSection(dueOf(task), new Date(now)) === "overdue";
    return (
      <li key={task.id} className={styles.item}>
        <div
          className={cx(
            styles.row,
            isOpen && styles.rowOpen,
            isInProgress(task) && styles.rowDoing,
            isCancelled(task) && styles.rowCancelled,
          )}
        >
          <Checkbox
            status={task.status}
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
              <span className={cx(styles.title, closed && styles.ticked)}>
                {task.title || "Untitled task"}
              </span>
            </span>
            <Meta task={task} now={now} overdue={overdue} />
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
                      section.kind === "doing" && styles.doing,
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
                    {section.tasks.map((task) => renderRow(task))}
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
