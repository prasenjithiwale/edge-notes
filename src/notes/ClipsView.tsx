import { Check, FilePlus, X } from "lucide-react";

import { cx } from "../lib/cx";
import { useNow } from "../lib/useNow";
import { filterClips, useClipsStore } from "../store/clips";
import { useNotesStore } from "../store/notes";
import { agoLabel } from "./ArchiveView";
import styles from "./ClipsView.module.css";

interface ClipsViewProps {
  query: string;
}

/**
 * The clipboard history: what was copied, newest first. Pressing an entry puts
 * it back on the clipboard; it can also become a note, or be forgotten.
 *
 * Every action is a visible button — nothing here is hover-only, because an
 * inactive panel on macOS may never see a hover.
 */
export function ClipsView({ query }: ClipsViewProps) {
  const clips = useClipsStore((state) => state.clips);
  const copiedId = useClipsStore((state) => state.copiedId);
  const copy = useClipsStore((state) => state.copy);
  const remove = useClipsStore((state) => state.remove);
  const clear = useClipsStore((state) => state.clear);
  const createWithContent = useNotesStore((state) => state.createWithContent);
  const now = useNow();

  const visible = filterClips(clips, query);

  if (clips.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.headline}>Nothing copied yet</p>
        <p className={styles.hint}>
          Text you copy in any app appears here. It is kept only until Ledge quits,
          and passwords from a password manager are never kept.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.top}>
        <p className={styles.note}>Kept until Ledge quits</p>
        <button
          type="button"
          className={styles.clear}
          onClick={() => {
            void clear();
          }}
        >
          Clear
        </button>
      </div>
      {visible.length === 0 ? (
        <p className={styles.hint}>Nothing copied matches “{query.trim()}”.</p>
      ) : (
        <ul className={styles.list}>
          {visible.map((clip) => {
            const copied = copiedId === clip.id;
            return (
              <li
                key={clip.id}
                className={cx(styles.row, clip.current && styles.current)}
                aria-current={clip.current ? "true" : undefined}
              >
                <button
                  type="button"
                  className={styles.body}
                  data-clip-row=""
                  aria-label={`Copy ${clip.text.slice(0, 80)}`}
                  onClick={() => {
                    void copy(clip);
                  }}
                >
                  <span className={styles.text}>{clip.text}</span>
                  <span className={styles.when} aria-live="polite">
                    {clip.current && <Check size={10} strokeWidth={2.5} aria-hidden="true" />}
                    {copied
                      ? "Copied"
                      : clip.current
                        ? "On the clipboard"
                        : agoLabel(clip.copiedAt, now)}
                  </span>
                </button>
                <span className={styles.actions}>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label="Save as note"
                    title="Save as note"
                    onClick={() => {
                      void createWithContent(clip.text);
                    }}
                  >
                    <FilePlus size={13} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label="Remove from history"
                    title="Remove from history"
                    onClick={() => {
                      void remove(clip.id);
                    }}
                  >
                    <X size={13} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
