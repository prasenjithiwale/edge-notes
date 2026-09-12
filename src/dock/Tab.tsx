import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { ChevronLeft } from "lucide-react";

import { cx } from "../lib/cx";
import { isOpenPhase } from "../lib/dock";
import { dockBeginTabDrag, dockEndTabDrag } from "../lib/ipc";
import { recentColors } from "../lib/notes";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import styles from "./Tab.module.css";

interface TabProps {
  className: string;
}

/**
 * The always-visible handle: a chevron pointing toward the screen centre, plus
 * up to three dots carrying the colours of the most recently edited notes
 * (brief 6.5).
 */
export function Tab({ className }: TabProps) {
  const phase = useDockStore((state) => state.phase);
  const notes = useNotesStore((state) => state.notes);
  const isOpen = isOpenPhase(phase);
  const dots = recentColors(notes);
  const dragging = useRef(false);

  const endDrag = useCallback(() => {
    if (!dragging.current) {
      return;
    }
    dragging.current = false;
    void dockEndTabDrag();
  }, []);

  // The pointer leaves the tab almost immediately once the window starts
  // following it, so the release has to be caught on the window, not the tab.
  // `pointercancel` matters too: a drag interrupted by the system would
  // otherwise leave Rust thinking the tab is still being dragged.
  useEffect(() => {
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      endDrag();
    };
  }, [endDrag]);

  return (
    <div
      className={cx(className, styles.tab, isOpen && styles.open)}
      onPointerDown={() => {
        dragging.current = true;
        void dockBeginTabDrag();
      }}
    >
      <ChevronLeft className={styles.chevron} size={16} strokeWidth={1.75} />
      {dots.length > 0 && (
        <div className={styles.dots} aria-hidden="true">
          {dots.map((color, index) => (
            <span
              // Colours repeat, so the index is the only stable key here.
              key={index}
              className={styles.dot}
              style={{ "--dot-bg": `var(--note-${color}-bg)` } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}
