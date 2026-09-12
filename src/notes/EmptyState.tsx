import styles from "./EmptyState.module.css";

/** Brief 6.10, plus the colour-filter case the brief does not name. */
export type EmptyStateKind =
  | { kind: "no-notes"; onCreate: () => void }
  | { kind: "no-matches"; query: string }
  | { kind: "no-colour" };

export function EmptyState(props: EmptyStateKind) {
  if (props.kind === "no-notes") {
    return (
      <div className={styles.empty}>
        <p className={styles.headline}>Capture your first note</p>
        <button type="button" className={styles.action} onClick={props.onCreate}>
          New note
        </button>
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      <p className={styles.message}>
        {props.kind === "no-matches"
          ? `No notes match “${props.query}”`
          : "No notes in this colour"}
      </p>
    </div>
  );
}
