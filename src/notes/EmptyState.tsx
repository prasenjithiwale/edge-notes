import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  onCreate: () => void;
}

/** Brief 6.10. The no-search-results variant arrives with search in M2. */
export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.headline}>Capture your first note</p>
      <button type="button" className={styles.action} onClick={onCreate}>
        New note
      </button>
    </div>
  );
}
