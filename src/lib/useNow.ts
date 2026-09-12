import { useSyncExternalStore } from "react";

/**
 * How coarse the clock is. The finest unit `editedLabel` prints is minutes, so
 * half-minute steps keep "Edited 2h ago" current without re-rendering the editor
 * on a timer faster than anything it could show.
 */
const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => {
    clearInterval(timer);
  };
}

/**
 * Quantised so repeated reads inside one render return the same value: React
 * requires a stable snapshot, and a raw `Date.now()` changes on every call.
 */
function snapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/**
 * The wall clock as a React value. The clock is external mutable state, so it is
 * read through a store subscription rather than during render.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
