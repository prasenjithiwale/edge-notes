import { useCallback, useSyncExternalStore } from "react";

import { isRunning } from "../lib/pomodoro";
import { usePomodoroStore } from "../store/pomodoro";

/**
 * Whether the phase that ends at `endsAt` is already over.
 *
 * Read as a subscription rather than a poll, because the answer changes exactly
 * once and the moment it changes is already known: one timer, set for the end,
 * and nothing running before or after it. The snapshot is a boolean, so it is
 * stable between renders and cannot drive a render loop the way a clock would.
 */
function useEndReached(endsAt: number | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (endsAt === null) {
        return () => undefined;
      }
      const left = endsAt - Date.now();
      if (left <= 0) {
        return () => undefined;
      }
      const timer = setTimeout(onChange, left);
      return () => {
        clearTimeout(timer);
      };
    },
    [endsAt],
  );

  const snapshot = useCallback(() => endsAt !== null && Date.now() >= endsAt, [endsAt]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Whether a focus session is counting *right now* — what the collapsed tab's
 * light means.
 *
 * `isRunning` on its own is not enough here. The timer's state only moves when
 * something asks it to (`settle`), and while the panel is collapsed nothing
 * asks: a session that ran out an hour ago would still say it was running, and
 * the light would still be on. So the end is watched for as well as the start.
 *
 * It only reads the state; settling it stays where it was, with whoever is
 * looking at the clock.
 */
export function useSessionRunning(): boolean {
  const state = usePomodoroStore((store) => store.state);
  // Both hooks run every render: `&&` would short-circuit past the second one.
  const ended = useEndReached(state.endsAt);
  return isRunning(state) && !ended;
}
