/**
 * Pure helpers for reading the dock phase. Rust owns the state machine; these
 * only describe how each phase should look and behave in the UI.
 */
import type { DockPhase } from "./ipc";

/** Phases where the group sits fully outside the docked edge. */
export function isClosedPhase(phase: DockPhase): boolean {
  return phase === "collapsed" || phase === "closing";
}

/** Phases where the chevron points back toward the edge. */
export function isOpenPhase(phase: DockPhase): boolean {
  return phase === "open" || phase === "opening";
}

/** Only the two animating phases expect a `dock_animation_done` call. */
export function isAnimatingPhase(
  phase: DockPhase,
): phase is "opening" | "closing" {
  return phase === "opening" || phase === "closing";
}

/**
 * The transition a phase should carry. Anything else must not animate: a
 * collapsed or settled panel that transitions would fire a stray acknowledgment.
 */
export function transitionFor(phase: DockPhase): "open" | "close" | "none" {
  if (phase === "opening") {
    return "open";
  }
  if (phase === "closing") {
    return "close";
  }
  return "none";
}
