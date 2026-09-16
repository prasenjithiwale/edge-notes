import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { cx } from "../lib/cx";
import { isAnimatingPhase, isClosedPhase, transitionFor } from "../lib/dock";
import {
  appReady,
  dockAnimationDone,
  dockPointerLeft,
  onDockState,
} from "../lib/ipc";
import { useDockStore } from "../store/dock";
import { Panel } from "./Panel";
import { Tab } from "./Tab";
import styles from "./DockShell.module.css";

/**
 * How long to wait for the post-paint frames before showing the window anyway.
 * Long enough that a visible window paints first, short enough to stay inside
 * the "visible tab in under a second" target (brief 11).
 */
const READY_FALLBACK_MS = 120;

/** Elements whose transition end counts as "the slide finished". */
function isSlideElement(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.dataset["slide"] === "true";
}

export function DockShell() {
  const phase = useDockStore((state) => state.phase);
  const side = useDockStore((state) => state.side);
  const tabTop = useDockStore((state) => state.tabTop);
  const applyState = useDockStore((state) => state.applyState);
  const panelWidth = useDockStore((state) => state.panelWidth);
  const frameRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    let announced = false;

    /**
     * Show the window, once. Nothing here may be skipped or deferred
     * indefinitely: until this runs the window is hidden, and a hidden window
     * is a widget the user cannot see at all.
     */
    const announceReady = () => {
      if (cancelled || announced) {
        return;
      }
      announced = true;
      void appReady();
    };

    // The listener must be attached before app_ready, because showing the window
    // emits the first dock:state and listen() resolves asynchronously — register
    // afterwards and that first state is lost.
    void (async () => {
      try {
        unlisten = await onDockState(applyState);
      } catch (error: unknown) {
        // A panel that misses dock:state is broken; a window that never appears
        // is invisible. Carry on and show it rather than stranding it hidden.
        console.error("dock: failed to listen for dock:state", error);
      }
      if (cancelled) {
        unlisten?.();
        return;
      }

      // Two frames: the first schedules the paint, the second runs after it, so
      // the window is only shown once there is something to see (brief 7.5).
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(announceReady);
      });

      // ...but the window starts hidden, and WebKit suspends rAF in a window
      // that has never been ordered in, so those callbacks never run at startup:
      // the window stayed hidden because it was hidden. This fallback is what
      // actually fires on a cold start; the frames win on a reload, when the
      // window is already on screen and waiting for the paint is real.
      timerRef.current = setTimeout(announceReady, READY_FALLBACK_MS);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, [applyState]);

  /**
   * Mark the root while the window does not have the keyboard, so a focus ring
   * stops claiming keys are going somewhere they are not.
   *
   * This widget is inactive nearly all the time — it is a panel beside whatever
   * you are actually working in — and a search field kept a lit accent ring
   * while every keystroke went to the app in front. Native controls dim when
   * their window resigns key; these now do too.
   */
  useEffect(() => {
    const root = document.documentElement;
    const mark = (active: boolean) => {
      if (active) {
        delete root.dataset["windowInactive"];
      } else {
        root.dataset["windowInactive"] = "";
      }
    };

    mark(document.hasFocus());
    const onFocus = () => {
      mark(true);
    };
    const onBlur = () => {
      mark(false);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      delete root.dataset["windowInactive"];
    };
  }, []);

  // Tell Rust the slide has finished so it can resize (closing) or settle (opening).
  const handleTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      // Only the group (transform) and the panel (opacity, under reduced motion)
      // count; the chevron animates transform too and must not acknowledge.
      if (!isSlideElement(event.target)) {
        return;
      }
      if (event.propertyName !== "transform" && event.propertyName !== "opacity") {
        return;
      }
      if (isAnimatingPhase(phase)) {
        void dockAnimationDone(phase);
      }
    },
    [phase],
  );

  // Linux secondary signal (brief 8.10): under XWayland the polled cursor can go
  // stale once the pointer is over a native Wayland window. Harmless elsewhere —
  // Rust ignores it unless the cursor really is outside.
  const handlePointerLeave = useCallback(() => {
    void dockPointerLeft();
  }, []);

  const className = cx(
    styles.viewport,
    isClosedPhase(phase) && styles.closed,
    transitionFor(phase) === "open" && styles.opening,
    transitionFor(phase) === "close" && styles.closing,
  );

  // Rust sizes the window, so the CSS has to paint to the same width: with the
  // token left static, a widened window simply grew a transparent margin and the
  // panel stayed 320 px. The width comes with dock:state rather than from
  // `panel.width`, because an expanded note's large panel depends on the monitor.
  const style = {
    "--tab-top": `${String(tabTop)}px`,
    "--panel-width": `${String(panelWidth)}px`,
  } as CSSProperties;

  return (
    <div
      className={className}
      style={style}
      data-side={side}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className={styles.group}
        data-slide="true"
        onTransitionEnd={handleTransitionEnd}
      >
        <Panel className={cx(styles.panel)} />
        <Tab className={cx(styles.tab)} />
      </div>
    </div>
  );
}
