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

const TABS: readonly { view: PanelView; label: string }[] = [
  { view: "notes", label: "Notes" },
  { view: "todo", label: "Tasks" },
];

/** Notes and Tasks, in place of the panel title. */
export function ViewTabs({ view, openTasks, onChange }: ViewTabsProps) {
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Panel view"
      style={
        { "--tab-index": TABS.findIndex((tab) => tab.view === view) } as CSSProperties
      }
    >
      <span className={styles.indicator} aria-hidden="true" />
      {TABS.map((tab) => {
        const selected = tab.view === view;
        const count = tab.view === "todo" && openTasks > 0 ? openTasks : null;
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            className={cx(styles.tab, selected && styles.selected)}
            aria-selected={selected}
            aria-label={count === null ? tab.label : `${tab.label}, ${String(count)} open`}
            onClick={() => {
              onChange(tab.view);
            }}
          >
            {tab.label}
            {count !== null && <span className={styles.count}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
