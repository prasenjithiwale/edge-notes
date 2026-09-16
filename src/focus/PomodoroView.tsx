import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import {
  dots,
  formatRemaining,
  isRunning,
  PHASE_LABELS,
  progress,
  remaining,
} from "../lib/pomodoro";
import { usePomodoroStore } from "../store/pomodoro";
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
function Ring({ value }: { value: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={styles.ring} viewBox="0 0 128 128" aria-hidden="true">
      <circle className={styles.track} cx="64" cy="64" r={radius} />
      <circle
        className={styles.progress}
        cx="64"
        cy="64"
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
 * Deliberately small — twenty-five minutes of focus, five off, fifteen after
 * four of them, start, pause, reset, skip. The lengths are not settings yet and
 * the count is not kept across a restart; both are worth doing and neither is
 * worth guessing at now.
 *
 * The clock is a moment in the future, not a number being counted down, so a
 * phase that ends while the panel is collapsed behind another app is still over
 * when you next look — and Rust says so through the same one-shot notification
 * thread the task reminders use.
 */
export function PomodoroView({ active }: PomodoroViewProps) {
  const state = usePomodoroStore((store) => store.state);
  const startTimer = usePomodoroStore((store) => store.startTimer);
  const pauseTimer = usePomodoroStore((store) => store.pauseTimer);
  const resetTimer = usePomodoroStore((store) => store.resetTimer);
  const skip = usePomodoroStore((store) => store.skip);
  const settle = usePomodoroStore((store) => store.settle);

  const running = isRunning(state);
  const now = useSeconds(active && running);

  // Whoever is watching the clock is also the one who notices it has run out.
  useEffect(() => {
    settle(now);
  }, [now, settle]);

  const left = remaining(state, now);
  const label = PHASE_LABELS[state.phase];

  return (
    <div className={styles.focus} role="tabpanel" aria-label="Focus">
      <p className={styles.phase}>{label}</p>

      <div className={styles.clock}>
        <Ring value={progress(state, now)} />
        <span
          className={styles.time}
          role="timer"
          aria-label={`${formatRemaining(left)} left of ${label.toLowerCase()}`}
        >
          {formatRemaining(left)}
        </span>
      </div>

      <div className={styles.dots} aria-label={`${String(state.streak % 4)} of 4 before a long break`}>
        {dots(state).map((filled, index) => (
          <span key={index} className={cx(styles.dot, filled && styles.dotFilled)} />
        ))}
      </div>

      <div className={styles.controls}>
        <IconButton
          label="Reset"
          onClick={() => {
            resetTimer();
          }}
        >
          <RotateCcw size={16} strokeWidth={1.75} />
        </IconButton>

        <button
          type="button"
          className={styles.primary}
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
          label={state.phase === "focus" ? "Skip to a break" : "Skip to focus"}
          onClick={() => {
            skip();
          }}
        >
          <SkipForward size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <p className={styles.tally}>
        {state.today === 0
          ? "Nothing finished yet today"
          : `${String(state.today)} finished today`}
      </p>
    </div>
  );
}
