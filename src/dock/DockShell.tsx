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
import { PlaceholderPanel } from "./PlaceholderPanel";
import { Tab } from "./Tab";
import styles from "./DockShell.module.css";

/** Elements whose transition end counts as "the slide finished". */
function isSlideElement(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.dataset["slide"] === "true";
}

export function DockShell() {
  const phase = useDockStore((state) => state.phase);
  const side = useDockStore((state) => state.side);
  const tabTop = useDockStore((state) => state.tabTop);
  const applyState = useDockStore((state) => state.applyState);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    // The listener must be attached before app_ready, because showing the window
    // emits the first dock:state and listen() resolves asynchronously — register
    // afterwards and that first state is lost.
    void (async () => {
      unlisten = await onDockState(applyState);
      if (cancelled) {
        unlisten();
        return;
      }
      // Two frames: the first schedules the paint, the second runs after it, so
      // the window is only shown once there is something to see (brief 7.5).
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(() => {
          void appReady();
        });
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [applyState]);

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

  const style = { "--tab-top": `${String(tabTop)}px` } as CSSProperties;

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
        <PlaceholderPanel className={cx(styles.panel)} />
        <Tab className={cx(styles.tab)} />
      </div>
    </div>
  );
}
