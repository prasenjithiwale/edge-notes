import styles from "./Toast.module.css";

interface ToastProps {
  message: string;
  actionLabel: string;
  onAction: () => void;
}

/**
 * Brief 6.9: deletes are soft and immediate, with an undo affordance instead of
 * a confirmation dialog.
 */
export function Toast({ message, actionLabel, onAction }: ToastProps) {
  return (
    <div className={styles.toast} role="status">
      <span>{message}</span>
      <button type="button" className={styles.action} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
