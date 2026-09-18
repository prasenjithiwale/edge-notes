import { useState } from "react";
import { Lock } from "lucide-react";

import {
  isIpcErrorOf,
  securityStartFresh,
  securityUnlock,
  type SecurityStatus,
} from "../lib/ipc";
import styles from "./LockedView.module.css";

/**
 * The panel when the notes are encrypted and the key is gone — a new machine, a
 * reset keychain, a restored backup.
 *
 * It is the whole panel rather than a message above the list, because there is
 * no list: nothing can be read until a key opens the file. Two ways out, and
 * only two: the recovery key from Settings on the machine that wrote it, or
 * setting the file aside and starting again. The second **renames**, never
 * deletes, and says so — a key found next week should still have something to
 * open.
 */
export function LockedView({
  status,
  onUnlocked,
}: {
  status: SecurityStatus;
  onUnlocked: (status: SecurityStatus) => void;
}) {
  const [recovery, setRecovery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingFresh, setConfirmingFresh] = useState(false);

  const unlock = () => {
    if (busy || recovery.trim() === "") {
      return;
    }
    setBusy(true);
    setError(null);
    void securityUnlock(recovery)
      .then(onUnlocked)
      .catch((problem: unknown) => {
        setError(
          isIpcErrorOf(problem, "locked")
            ? "That key does not open these notes."
            : "The notes could not be unlocked.",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className={styles.view}>
      <div className={styles.icon} aria-hidden="true">
        <Lock size={20} strokeWidth={1.75} />
      </div>
      <h2 className={styles.heading}>Your notes are locked</h2>
      <p className={styles.detail}>
        {status.detail === ""
          ? "They are encrypted, and the key for them is not on this system."
          : `${status.detail.charAt(0).toUpperCase()}${status.detail.slice(1)}.`}
      </p>
      <p className={styles.detail}>
        Paste the recovery key from Settings › Privacy on the machine that wrote
        these notes. Nothing is deleted while they are locked.
      </p>

      <label className={styles.field}>
        <span className={styles.label}>Recovery key</span>
        <textarea
          className={styles.input}
          value={recovery}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={3}
          placeholder="A1B2C3D4-E5F6…"
          onChange={(event) => {
            setRecovery(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            // Enter unlocks; Shift+Enter is for pasting a key across lines.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              unlock();
            }
          }}
        />
      </label>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className={styles.unlock}
        disabled={busy || recovery.trim() === ""}
        onClick={unlock}
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>

      {/* Asks in place rather than in a dialog, like deleting for good does:
          the panel has no modals. */}
      {confirmingFresh ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>
            Start again with an empty set of notes? The locked file is kept,
            renamed beside it, in case the key turns up.
          </p>
          <div className={styles.confirmRow}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setConfirmingFresh(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void securityStartFresh()
                  .then(onUnlocked)
                  .catch(() => {
                    setError("The locked notes could not be set aside.");
                  })
                  .finally(() => {
                    setBusy(false);
                    setConfirmingFresh(false);
                  });
              }}
            >
              Start fresh
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            setConfirmingFresh(true);
          }}
        >
          Start fresh instead
        </button>
      )}
    </div>
  );
}
