import type { CSSProperties } from "react";

import { cx } from "../lib/cx";
import type { PanelView } from "../store/notes";
import styles from "./ViewTabs.module.css";

interface ViewTabsProps {
  view: PanelView;
  /** Open tasks, shown on the Tasks tab; hidden at zero. */
  openTasks: number;
  onChange: (view: PanelView) => void;
}

export const TABS: readonly { view: PanelView; label: string }[] = [
  { view: "notes", label: "Notes" },
  { view: "todo", label: "Tasks" },
  { view: "focus", label: "Focus" },
];

/** The panel's tabs, in place of its title. */
export function ViewTabs({ view, openTasks, onChange }: ViewTabsProps) {
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
          "--tab-width": `calc((100% - ${String((count + 1) * 2)}px) / ${String(count)})`,
        } as CSSProperties
      }
    >
      <span className={styles.indicator} aria-hidden="true" />
      {TABS.map((tab) => {
        const selected = tab.view === view;
        const badge = tab.view === "todo" && openTasks > 0 ? openTasks : null;
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            className={cx(styles.tab, selected && styles.selected)}
            aria-selected={selected}
            aria-label={badge === null ? tab.label : `${tab.label}, ${String(badge)} open`}
            onClick={() => {
              onChange(tab.view);
            }}
          >
            {tab.label}
            {badge !== null && <span className={styles.count}>{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
