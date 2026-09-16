import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Pause, Play, RotateCcw, SkipForward, X } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import {
  dots,
  endsLabel,
  formatRemaining,
  isRunning,
  PHASE_HINTS,
  PHASE_LABELS,
  progress,
  remaining,
  tallyLabel,
} from "../lib/pomodoro";
import { compareTasks, dateKey, isDone } from "../lib/taskMeta";
import { usePomodoroStore } from "../store/pomodoro";
import { useTasksStore } from "../store/tasks";
import styles from "./PomodoroView.module.css";

interface PomodoroViewProps {
  /** The tab is showing. It stays mounted while hidden so the track can slide. */
  active: boolean;
}

/** Quantised to the second so repeated reads in one render agree, as `useNow` is. */
function secondsNow(): number {
  return Math.floor(Date.now() / 1_000) * 1_000;
}

/**
 * A clock that ticks once a second, and only while there is something to watch.
 *
 * The rest of the app reads `useNow`, which moves in half-minutes because
 * nothing else shows seconds. A second hand is worth its own interval; an idle
 * one is not, so the subscription exists only while the timer is running and the
 * tab is up — the value is still read the same way either way.
 */
function useSeconds(active: boolean): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) {
        return () => undefined;
      }
      const timer = setInterval(onChange, 1_000);
      return () => {
        clearInterval(timer);
      };
    },
    [active],
  );
  return useSyncExternalStore(subscribe, secondsNow, secondsNow);
}

/** The ring: a track and the part of it that has gone. */
function Ring({ value, muted }: { value: number; muted: boolean }) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={styles.ring} viewBox="0 0 160 160" aria-hidden="true">
      <circle className={styles.track} cx="80" cy="80" r={radius} />
      <circle
        className={cx(styles.progress, muted && styles.progressMuted)}
        cx="80"
        cy="80"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
      />
    </svg>
  );
}

/**
 * The Focus tab: a pomodoro timer.
 *
 * The clock is a moment in the future, not a number being counted down, so a
 * phase that ends while the panel is collapsed behind another app is still over
 * when you next look — and Rust says so through the same one-shot notification
 * thread the task reminders use.
 *
 * The lengths, the run to the long break, whether the next phase starts by
 * itself and the day's tally are all stored now (`focus.*` in Settings), so the
 * tab is the same when you come back to it as when you left.
 */
export function PomodoroView({ active }: PomodoroViewProps) {
  const state = usePomodoroStore((store) => store.state);
  const taskId = usePomodoroStore((store) => store.taskId);
  const setTask = usePomodoroStore((store) => store.setTask);
  const startTimer = usePomodoroStore((store) => store.startTimer);
  const pauseTimer = usePomodoroStore((store) => store.pauseTimer);
  const resetTimer = usePomodoroStore((store) => store.resetTimer);
  const skip = usePomodoroStore((store) => store.skip);
  const settle = usePomodoroStore((store) => store.settle);

  const tasks = useTasksStore((store) => store.tasks);
  const tasksLoaded = useTasksStore((store) => store.loaded);
  const tick = useTasksStore((store) => store.tick);

  const running = isRunning(state);
  const now = useSeconds(active && running);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Whoever is watching the clock is also the one who notices it has run out.
  // `active` is a dependency as well as `now`: coming back to the tab after the
  // session ended out of sight has to settle it on the first frame.
  useEffect(() => {
    settle(active ? now : Date.now());
  }, [now, active, settle]);

  // A picker left open on a tab that has slid away would be waiting there on
  // the way back, over a task that may since have been ticked or deleted.
  // Adjusted while rendering rather than in an effect — React's own recipe —
  // so the first frame of the visit is already closed.
  const [seenActive, setSeenActive] = useState(active);
  if (active !== seenActive) {
    setSeenActive(active);
    if (!active) {
      setPicking(false);
    }
  }

  const left = remaining(state, now);
  const label = PHASE_LABELS[state.phase];
  const focusing = state.phase === "focus";

  const task = tasks.find((candidate) => candidate.id === taskId && !isDone(candidate));
  const openTasks = tasks.filter((candidate) => !isDone(candidate)).sort(compareTasks);

  // A task ticked or deleted elsewhere stops being this session's, rather than
  // leaving the row naming something that is no longer on the list. Not before
  // the tasks have loaded: the id is read back from storage at startup, and an
  // empty list is "not loaded yet", not "that task is gone".
  useEffect(() => {
    if (tasksLoaded && taskId !== null && task === undefined) {
      setTask(null);
    }
  }, [tasksLoaded, taskId, task, setTask]);

  return (
    <div ref={rootRef} className={styles.focus} role="tabpanel" aria-label="Focus">
      <div className={styles.head}>
        <p className={cx(styles.phase, !focusing && styles.phaseBreak)}>{label}</p>
        <p className={styles.hint}>{PHASE_HINTS[state.phase]}</p>
      </div>

      <div className={styles.clock}>
        <Ring value={progress(state, now)} muted={!focusing} />
        <div className={styles.readout}>
          <span
            className={styles.time}
            role="timer"
            aria-label={`${formatRemaining(left)} left of ${label.toLowerCase()}`}
          >
            {formatRemaining(left)}
          </span>
          <span className={styles.ends}>{endsLabel(state)}</span>
        </div>
      </div>

      <div
        className={styles.dots}
        aria-label={`${String(state.streak % state.durations.longEvery)} of ${String(
          state.durations.longEvery,
        )} before a long break`}
      >
        {dots(state).map((filled, index) => (
          <span key={index} className={cx(styles.dot, filled && styles.dotFilled)} />
        ))}
      </div>

      {/* What the session is for. A pomodoro with nothing attached to it is a
          kitchen timer; naming the task is what makes the tally mean something,
          and it is the only place the two tabs meet. */}
      <div className={styles.workingOn}>
        <button
          type="button"
          className={styles.taskRow}
          aria-expanded={picking}
          onClick={() => {
            setPicking((shown) => !shown);
          }}
        >
          <span className={styles.taskCaption}>Working on</span>
          <span className={cx(styles.taskName, task === undefined && styles.taskNone)}>
            {task === undefined ? "Nothing in particular" : task.title || "Untitled task"}
          </span>
          <ChevronDown
            size={12}
            strokeWidth={2}
            className={cx(styles.chevron, picking && styles.chevronOpen)}
            aria-hidden="true"
          />
        </button>

        {task !== undefined && !picking && (
          <div className={styles.taskActions}>
            <IconButton
              label="Finish this task"
              onClick={() => {
                void tick(task.id);
                setTask(null);
              }}
            >
              <Check size={14} strokeWidth={2} />
            </IconButton>
            <IconButton
              label="Work on nothing in particular"
              onClick={() => {
                setTask(null);
              }}
            >
              <X size={14} strokeWidth={2} />
            </IconButton>
          </div>
        )}
      </div>

      {picking && (
        <ul className={styles.picker} aria-label="Open tasks">
          {openTasks.length === 0 ? (
            <li className={styles.pickerEmpty}>Nothing open in Tasks</li>
          ) : (
            openTasks.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className={cx(styles.pick, candidate.id === taskId && styles.picked)}
                  aria-pressed={candidate.id === taskId}
                  onClick={() => {
                    setTask(candidate.id === taskId ? null : candidate.id);
                    setPicking(false);
                  }}
                >
                  {candidate.title || "Untitled task"}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className={styles.controls}>
        <IconButton
          label="Reset"
          shortcut="R"
          onClick={() => {
            resetTimer();
          }}
        >
          <RotateCcw size={16} strokeWidth={1.75} />
        </IconButton>

        <button
          type="button"
          className={styles.primary}
          data-focus-primary=""
          onClick={() => {
            if (running) {
              pauseTimer();
            } else {
              startTimer();
            }
          }}
        >
          {running ? <Pause size={14} strokeWidth={2} /> : <Play size={14} strokeWidth={2} />}
          {running ? "Pause" : "Start"}
        </button>

        <IconButton
          label={focusing ? "Skip to a break" : "Skip to focus"}
          shortcut="S"
          onClick={() => {
            skip();
          }}
        >
          <SkipForward size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <p className={styles.tally} role="status">
        {tallyLabel(state, dateKey(new Date(now)))}
      </p>
    </div>
  );
}
