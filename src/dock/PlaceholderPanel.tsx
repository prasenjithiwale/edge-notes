import { Pin } from "lucide-react";

import { cx } from "../lib/cx";
import { useDockStore } from "../store/dock";
import styles from "./PlaceholderPanel.module.css";

interface PlaceholderPanelProps {
  className: string;
}

/**
 * M0 placeholder: a plain surface, the Keep open toggle, and a text field for
 * verifying that typing works while another app is active. The notes UI is M1.
 */
export function PlaceholderPanel({ className }: PlaceholderPanelProps) {
  const phase = useDockStore((state) => state.phase);
  const keepOpen = useDockStore((state) => state.keepOpen);
  const setKeepOpen = useDockStore((state) => state.setKeepOpen);
  const setInteractionLock = useDockStore((state) => state.setInteractionLock);

  return (
    <section className={cx(className, styles.panel)} data-slide="true">
      <header className={styles.header}>
        <h1 className={styles.title}>Notes</h1>
        <button
          type="button"
          className={cx(styles.iconButton, keepOpen && styles.iconButtonActive)}
          aria-label="Keep open"
          aria-pressed={keepOpen}
          title="Keep open"
          onClick={() => {
            setKeepOpen(!keepOpen);
          }}
        >
          <Pin size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className={styles.body}>
        <p className={styles.note}>
          Docking spike. The notes list lands in the next milestone.
        </p>
        <input
          className={styles.input}
          type="text"
          aria-label="Typing test"
          placeholder="Type here to test focus"
          /* The interaction lock is what stops the panel closing mid-sentence. */
          onFocus={() => {
            setInteractionLock(true);
          }}
          onBlur={() => {
            setInteractionLock(false);
          }}
        />
        <p className={styles.meta}>Phase: {phase}</p>
      </div>
    </section>
  );
}
