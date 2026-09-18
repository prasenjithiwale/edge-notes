import { useEffect, useState } from "react";
import { ArrowLeft, ListChecks, StickyNote, Trash2 } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import type { ArchivedItem } from "../lib/ipc";
import { useNow } from "../lib/useNow";
import { useArchiveStore } from "../store/archive";
import { noteColorStyle } from "./NoteCard";
import styles from "./ArchiveView.module.css";

interface ArchiveViewProps {
  onClose: () => void;
}

/** The first line with anything in it — the same heading a card shows. */
function headline(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line ?? "";
}

/** The line under it: what follows the heading, on one line. */
function preview(text: string): string {
  const lines = text.split("\n").map((part) => part.trim());
  const start = lines.findIndex((part) => part !== "");
  return lines
    .slice(start + 1)
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * "Just now", "2 hours ago", "3 days ago". Coarse on purpose: the question is
 * which one you deleted, and the answer is an order, not a timestamp.
 */
export function agoLabel(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${String(minutes)} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${String(days)} ${days === 1 ? "day" : "days"} ago`;
}

/** How long is left before it is purged, in whole days, never below zero. */
export function keptLabel(purgeAt: number, now: number): string {
  const days = Math.max(0, Math.ceil((purgeAt - now) / 86_400_000));
  if (days <= 1) {
    return "Kept until tomorrow";
  }
  return `Kept for ${String(days)} more days`;
}

function Row({ item, now }: { item: ArchivedItem; now: number }) {
  const restore = useArchiveStore((state) => state.restore);
  const purge = useArchiveStore((state) => state.purge);
  const restoringId = useArchiveStore((state) => state.restoringId);
  const busy = restoringId === item.id;
  /**
   * Armed to delete for good.
   *
   * Everything else in the app answers a mistake with an undo, which is better
   * than a confirmation (brief 6.9) — but there is nothing behind this one, so
   * it is the single place a question is the right answer. Asked in the row
   * rather than in a dialog: the panel has no modals, and the row is what the
   * question is about.
   */
  const [arming, setArming] = useState(false);

  const title = headline(item.text);
  const rest = item.kind === "note" ? preview(item.text) : "";
  const named = title === "" ? `empty ${item.kind}` : title;

  return (
    <li className={styles.row}>
      <span
        className={cx(styles.dot, item.kind === "task" && styles.taskDot)}
        style={item.color === null ? undefined : noteColorStyle(item.color)}
        aria-hidden="true"
      >
        {item.kind === "note" ? (
          <StickyNote size={11} strokeWidth={2} />
        ) : (
          <ListChecks size={11} strokeWidth={2} />
        )}
      </span>

      <span className={styles.body}>
        <span className={styles.title}>
          {title === "" ? <em className={styles.untitled}>Empty {item.kind}</em> : title}
        </span>
        {rest !== "" && <span className={styles.preview}>{rest}</span>}
        <span className={styles.when}>
          {agoLabel(item.deletedAt, now)} · {keptLabel(item.purgeAt, now)}
        </span>
      </span>

      {arming ? (
        <span className={styles.actions}>
          <button
            type="button"
            className={cx(styles.action, styles.danger)}
            aria-label={`Delete ${named} for good`}
            onClick={() => {
              void purge(item);
            }}
          >
            Delete for good
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              setArming(false);
            }}
          >
            Keep
          </button>
        </span>
      ) : (
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            disabled={restoringId !== null}
            // Named for the thing it puts back: a column of buttons all saying
            // "Restore" says nothing on its own to anyone reading it aloud.
            aria-label={`Restore ${named}`}
            onClick={() => {
              void restore(item);
            }}
          >
            {busy ? "Restoring" : "Restore"}
          </button>
          <button
            type="button"
            className={styles.discard}
            aria-label={`Delete ${named} permanently`}
            title="Delete permanently"
            onClick={() => {
              setArming(true);
            }}
          >
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * Everything deleted in the last thirty days, and a way to put it back.
 *
 * Deleting has always been undoable and has always kept the row — but only for
 * as long as the toast was up, as far as anyone could see. This is the rest of
 * that promise: the toast is the fast way back, and this is the one that is
 * still there tomorrow.
 *
 * Notes and tasks in one list, newest first, because the question it answers is
 * "where did the thing I just deleted go" and that is a question about when.
 */
export function ArchiveView({ onClose }: ArchiveViewProps) {
  const items = useArchiveStore((state) => state.items);
  const load = useArchiveStore((state) => state.load);
  // The clock as a React value, quantised: "2 minutes ago" is allowed to age
  // while the list is open, and reading `Date.now()` during render is not.
  const now = useNow();

  // Opening it is the moment to be sure: something may have been deleted from
  // another tab, or purged at the last start.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.view} role="region" aria-label="Archive">
      <div className={styles.top}>
        <IconButton label="Back to notes" onClick={onClose}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </IconButton>
        <h2 className={styles.heading}>Archive</h2>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.headline}>Nothing deleted</p>
          <p className={styles.hint}>
            Anything you delete waits here for thirty days before it goes for good.
          </p>
        </div>
      ) : (
        <>
          <p className={styles.note}>
            Deleted notes and tasks are kept for thirty days. Restoring one puts it
            back where it was; deleting it here is the one thing in Ledge that
            cannot be undone.
          </p>
          <ul className={styles.list}>
            {items.map((item) => (
              <Row key={item.id} item={item} now={now} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
