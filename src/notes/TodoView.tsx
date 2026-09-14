import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";

import { cx } from "../lib/cx";
import type { Line } from "../lib/markdown";
import { collectTasks, type Task } from "../lib/tasks";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { LineRow } from "./NoteText";
import styles from "./TodoView.module.css";

interface TodoViewProps {
  /** Open a note in the Notes tab's editor. */
  onOpenNote: (id: string) => void;
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
 * Every checklist item from every note, grouped by note. Ticking here edits the
 * note. "Add a task" appends to the note titled To-Do.
 *
 * The view holds still while it is in use: a task ticked here stays in place,
 * struck through, until the tab is left or the panel collapses, and groups keep
 * the order they had when the tab opened — ticking edits a note, which would
 * otherwise move its whole group to the top under the cursor.
 */
export function TodoView({ onOpenNote }: TodoViewProps) {
  const notes = useNotesStore((state) => state.notes);
  const draft = useNotesStore((state) => state.taskDraft);
  const setDraft = useNotesStore((state) => state.setTaskDraft);
  const addTask = useNotesStore((state) => state.addTask);
  const toggleTask = useNotesStore((state) => state.toggleTask);
  const phase = useDockStore((state) => state.phase);
  const setLock = useDockStore((state) => state.setLock);

  const [focused, setFocused] = useState(false);
  const [tickedHere, setTickedHere] = useState<ReadonlySet<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(() => collectTasks(notes), [notes]);
  const [order] = useState(() => groups.map((group) => group.note.id));

  // Held while typing a task, as the search field holds it (brief 6.3). Derived
  // from state, never acquired in one handler and released in another.
  useEffect(() => {
    setLock("todo", focused);
    return () => {
      setLock("todo", false);
    };
  }, [focused, setLock]);

  // A collapse is the end of a visit, like leaving the tab. Adjusted while
  // rendering, when the phase changes, rather than in an effect that would
  // render the stale list once first.
  const [seenPhase, setSeenPhase] = useState(phase);
  if (phase !== seenPhase) {
    setSeenPhase(phase);
    if (phase === "collapsed") {
      setTickedHere(new Set());
    }
  }

  // Groups that did not exist when the tab opened (the To-Do note, the first time
  // a task is added) go first, where the new task can be seen.
  const ordered = useMemo(() => {
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...groups].sort(
      (a, b) => (rank.get(a.note.id) ?? -1) - (rank.get(b.note.id) ?? -1),
    );
  }, [groups, order]);

  const openGroups = ordered
    .map((group) => ({
      ...group,
      tasks: group.tasks.filter((task) => !task.checked || tickedHere.has(taskKey(task))),
    }))
    .filter((group) => group.tasks.length > 0);
  const done = ordered.flatMap((group) =>
    group.tasks
      .filter((task) => task.checked && !tickedHere.has(taskKey(task)))
      .map((task) => ({ task, title: group.title })),
  );
  const hasAnyTask = groups.length > 0;

  const tick = (task: Task) => {
    if (!task.checked) {
      setTickedHere((current) => new Set(current).add(taskKey(task)));
    }
    toggleTask(task.noteId, task.line);
  };

  return (
    <div className={styles.todo} role="tabpanel" aria-label="To-Do">
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
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
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
        {hasAnyTask && openGroups.length === 0 && (
          <p className={cx(styles.message, styles.allDone)}>All done</p>
        )}

        {openGroups.map((group) => (
          <section key={group.note.id} className={styles.group}>
            <button
              type="button"
              className={styles.groupTitle}
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
              <span className={styles.groupName}>{group.title}</span>
            </button>
            {group.tasks.map((task) => (
              <LineRow
                key={taskKey(task)}
                line={asLine(task)}
                wrap
                className={styles.task}
                onToggle={() => {
                  tick(task);
                }}
              />
            ))}
          </section>
        ))}

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
            {showDone &&
              done.map(({ task, title }) => (
                <div key={taskKey(task)} className={styles.doneRow}>
                  <LineRow
                    line={asLine(task)}
                    wrap
                    className={styles.task}
                    onToggle={() => {
                      tick(task);
                    }}
                  />
                  <span className={styles.doneFrom}>{title}</span>
                </div>
              ))}
          </section>
        )}
      </div>
    </div>
  );
}
