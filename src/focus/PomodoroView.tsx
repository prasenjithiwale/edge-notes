import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  ChevronDown,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  X,
} from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import {
  dots,
  endsLabel,
  formatRemaining,
  isRunning,
  PHASE_HINTS,
  PHASE_LABELS,
  type Phase,
  PRESETS,
  progress,
  remaining,
  type Session,
  tallyLabel,
  timeline,
} from "../lib/pomodoro";
import { compareTasks, dateKey, isClosed } from "../lib/taskMeta";
import { clampSetting, FOCUS_MINUTES } from "../settings/limits";
import { useDockStore } from "../store/dock";
import { useSettingsStore } from "../store/settings";
import { usePomodoroStore } from "../store/pomodoro";
import { useTasksStore } from "../store/tasks";
import styles from "./PomodoroView.module.css";

type LengthKey = "focus.focusMinutes" | "focus.breakMinutes" | "focus.longBreakMinutes";

/** Which setting each phase's length is, and how far a press of − or + moves it. */
const LENGTH: Record<Phase, { key: LengthKey; step: number; name: string }> = {
  focus: { key: "focus.focusMinutes", step: 5, name: "Session length" },
  short: { key: "focus.breakMinutes", step: 1, name: "Break length" },
  long: { key: "focus.longBreakMinutes", step: 5, name: "Long break length" },
};

/**
 * The length of the phase in front of you, set where the timer is rather than
 * only in Settings: − and + nudge it, and the number is a field that takes any
 * length in range. Only drawn while the timer is not running — a running phase
 * keeps its end whatever the setting says (`withDurations`), so a control there
 * would appear to do nothing. Writes the same setting Settings › Focus does.
 */
function LengthControl({ phase }: { phase: Phase }) {
  const { key, step, name } = LENGTH[phase];
  const minutes = useSettingsStore((store) => store.settings[key]);
  const patch = useSettingsStore((store) => store.patch);
  const setLock = useDockStore((store) => store.setLock);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  // Typing a length holds the panel open, as the search field does; derived
  // from state so a remount cannot drop it (see the interaction-lock notes).
  useEffect(() => {
    setLock("focus", editing);
    return () => {
      setLock("focus", false);
    };
  }, [editing, setLock]);

  const set = (next: number) => {
    const clamped = Math.min(Math.max(next, FOCUS_MINUTES.min), FOCUS_MINUTES.max);
    if (clamped !== minutes) {
      void patch({ [key]: clamped });
    }
  };
  const commit = () => {
    if (draft !== null) {
      set(clampSetting(draft, { ...FOCUS_MINUTES, fallback: minutes }));
    }
    setDraft(null);
  };

  return (
    <div className={styles.length} role="group" aria-label={name}>
      <button
        type="button"
        className={styles.lengthStep}
        aria-label={`${name}: less`}
        disabled={minutes <= FOCUS_MINUTES.min}
        onClick={() => {
          set(minutes - step);
        }}
      >
        <Minus size={12} strokeWidth={2.5} />
      </button>
      <label className={styles.lengthValue}>
        <input
          className={styles.lengthInput}
          type="number"
          inputMode="numeric"
          min={FOCUS_MINUTES.min}
          max={FOCUS_MINUTES.max}
          aria-label={`${name} in minutes`}
          value={draft ?? String(minutes)}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        min
      </label>
      <button
        type="button"
        className={styles.lengthStep}
        aria-label={`${name}: more`}
        disabled={minutes >= FOCUS_MINUTES.max}
        onClick={() => {
          set(minutes + step);
        }}
      >
        <Plus size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/**
 * The rhythms most people use, one press each. Sets the focus and break lengths
 * together — the same two settings the stepper and Settings › Focus write — and
 * is lit when both already match. Drawn only while stopped, as the stepper is.
 */
function Presets() {
  const focus = useSettingsStore((store) => store.settings["focus.focusMinutes"]);
  const rest = useSettingsStore((store) => store.settings["focus.breakMinutes"]);
  const patch = useSettingsStore((store) => store.patch);
  return (
    <div className={styles.presets} role="group" aria-label="Rhythm">
      {PRESETS.map(([minutes, pause]) => {
        const on = minutes === focus && pause === rest;
        return (
          <button
            key={minutes}
            type="button"
            className={cx(styles.preset, on && styles.presetOn)}
            aria-pressed={on}
            aria-label={`${String(minutes)} minutes of focus, ${String(pause)} minute breaks`}
            onClick={() => {
              if (!on) {
                void patch({ "focus.focusMinutes": minutes, "focus.breakMinutes": pause });
              }
            }}
          >
            {minutes}
            <span className={styles.presetRest}>/{pause}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "9", "14": an hour on the timeline's scale, in the locale's own clock. */
function hourLabel(hour: number): string {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(at);
}

/**
 * Today on one bar: each finished focus session a block, and a tick where now
 * is. A count says how many; this says when, and where the gaps were.
 */
function DayTimeline({ log, now }: { log: readonly Session[]; now: number }) {
  const { from, to, blocks, now: at } = timeline(log, now);
  return (
    <div className={styles.timeline}>
      <div className={styles.timelineBar} aria-hidden="true">
        {blocks.map((block, index) => (
          <span
            key={index}
            className={styles.timelineBlock}
            style={{ left: `${String(block.left * 100)}%`, width: `${String(block.width * 100)}%` }}
          />
        ))}
        <span className={styles.timelineNow} style={{ left: `${String(at * 100)}%` }} />
      </div>
      <div className={styles.timelineScale} aria-hidden="true">
        <span>{hourLabel(from)}</span>
        <span>{hourLabel(to % 24)}</span>
      </div>
    </div>
  );
}

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

/** The ring: a track and the part of it that has gone, in the phase's colour. */
function Ring({ value }: { value: number }) {
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={styles.ring} viewBox="0 0 200 200" aria-hidden="true">
      <circle className={styles.track} cx="100" cy="100" r={radius} />
      <circle
        className={styles.progress}
        cx="100"
        cy="100"
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

  const task = tasks.find((candidate) => candidate.id === taskId && !isClosed(candidate));
  const openTasks = tasks.filter((candidate) => !isClosed(candidate)).sort(compareTasks);

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
    <div
      ref={rootRef}
      className={styles.focus}
      data-phase={state.phase}
      role="tabpanel"
      aria-label="Focus"
    >
      <div className={styles.head}>
        <p className={cx(styles.phase, !focusing && styles.phaseBreak)}>{label}</p>
        <p className={styles.hint}>{PHASE_HINTS[state.phase]}</p>
      </div>

      <div className={styles.clock}>
        <div className={cx(styles.orb, running && styles.orbLive)} aria-hidden="true" />
        <Ring value={progress(state, now)} />
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

      {!running && (
        <div className={styles.setup}>
          {focusing && <Presets />}
          <LengthControl phase={state.phase} />
        </div>
      )}

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

      <div className={styles.day}>
        <DayTimeline log={state.day === dateKey(new Date(now)) ? state.log : []} now={now} />
        <p className={styles.tally} role="status">
          {tallyLabel(state, dateKey(new Date(now)))}
        </p>
      </div>
    </div>
  );
}
