import { cx } from "../lib/cx";
import styles from "./TagFilter.module.css";

interface TagFilterProps {
  /** Tags of the notes matching the query, most used first (idea 16). */
  tags: readonly string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

/**
 * The `#tags` written in the notes, as chips under the colour row.
 *
 * Its own row rather than more chips beside the dots: a fourteen-pixel dot and a
 * word-long pill do not read as one row of the same kind of thing, and the row
 * is only drawn when some note actually has a tag — an empty row of chrome is
 * the panel's scarcest thing spent on nothing.
 */
export function TagFilter({ tags, selected, onSelect }: TagFilterProps) {
  return (
    <div className={styles.row} role="group" aria-label="Filter by tag">
      {tags.map((tag) => {
        const active = selected !== null && selected.toLowerCase() === tag.toLowerCase();
        return (
          <button
            key={tag.toLowerCase()}
            type="button"
            className={cx(styles.chip, active && styles.chipSelected)}
            aria-pressed={active}
            onClick={() => {
              onSelect(tag);
            }}
          >
            {`#${tag}`}
          </button>
        );
      })}
    </div>
  );
}
