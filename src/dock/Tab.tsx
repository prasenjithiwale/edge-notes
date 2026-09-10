import { ChevronLeft } from "lucide-react";

import { cx } from "../lib/cx";
import { isOpenPhase } from "../lib/dock";
import { useDockStore } from "../store/dock";
import styles from "./Tab.module.css";

interface TabProps {
  className: string;
}

/**
 * The always-visible handle. In M0 it carries only the chevron; the three
 * recent-note colour dots arrive with the notes UI in M1.
 */
export function Tab({ className }: TabProps) {
  const phase = useDockStore((state) => state.phase);
  const isOpen = isOpenPhase(phase);

  return (
    <div className={cx(className, styles.tab, isOpen && styles.open)}>
      <ChevronLeft className={styles.chevron} size={16} strokeWidth={1.75} />
    </div>
  );
}
