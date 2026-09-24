import type { CSSProperties } from "react";

import { cx } from "../lib/cx";
import type { PanelView } from "../store/notes";
import styles from "./ViewTabs.module.css";

interface ViewTabsProps {
  view: PanelView;
  /** Open tasks, shown on the Tasks tab; hidden at zero. */
  openTasks: number;
  /** A focus session is running, shown as a dot on the Focus tab. */
  focusRunning: boolean;
  onChange: (view: PanelView) => void;
}

export const TABS: readonly { view: PanelView; label: string }[] = [
  { view: "notes", label: "Notes" },
  { view: "todo", label: "Tasks" },
  { view: "focus", label: "Focus" },
  { view: "clips", label: "Clips" },
];

/** The panel's tabs, in place of its title. */
export function ViewTabs({ view, openTasks, focusRunning, onChange }: ViewTabsProps) {
  const count = TABS.length;
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Panel view"
      // The count travels in the style rather than the stylesheet: CSS cannot
      // divide by a custom property everywhere this has to run, and `repeat()`
      // will not take one at all.
      style={
        {
          "--tab-index": TABS.findIndex((tab) => tab.view === view),
          gridTemplateColumns: `repeat(${String(count)}, minmax(0, 1fr))`,
          // 3 px of padding each side and a 2 px gap between segments.
          "--tab-width": `calc((100% - ${String(6 + (count - 1) * 2)}px) / ${String(count)})`,
        } as CSSProperties
      }
    >
      <span className={styles.indicator} aria-hidden="true" />
      {TABS.map((tab) => {
        const selected = tab.view === view;
        const badge = tab.view === "todo" && openTasks > 0 ? openTasks : null;
        // A timer counting down behind another tab is worth knowing about, and
        // a dot says so without a number that would change every second and
        // resize its segment.
        const running = tab.view === "focus" && focusRunning;
        const label = badge !== null ? `${tab.label}, ${String(badge)} open` : running ? `${tab.label}, running` : tab.label;
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            className={cx(styles.tab, selected && styles.selected)}
            aria-selected={selected}
            aria-label={label}
            onClick={() => {
              onChange(tab.view);
            }}
          >
            {tab.label}
            {badge !== null && <span className={styles.count}>{badge}</span>}
            {running && <span className={styles.running} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
