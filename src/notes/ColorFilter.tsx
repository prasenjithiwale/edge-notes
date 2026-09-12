import type { CSSProperties } from "react";

import { cx } from "../lib/cx";
import type { NoteColor } from "../lib/ipc";
import { colorName } from "../lib/notes";
import styles from "./ColorFilter.module.css";

interface ColorFilterProps {
  /** Palette ids with at least one matching note, in palette order (brief 6.7). */
  colors: readonly NoteColor[];
  selected: NoteColor | null;
  onSelect: (color: NoteColor | null) => void;
}

export function ColorFilter({ colors, selected, onSelect }: ColorFilterProps) {
  return (
    <div className={styles.row} role="group" aria-label="Filter by colour">
      <button
        type="button"
        className={cx(styles.chip, selected === null && styles.chipSelected)}
        aria-pressed={selected === null}
        onClick={() => {
          onSelect(null);
        }}
      >
        All
      </button>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={cx(styles.dot, selected === color && styles.dotSelected)}
          style={{ "--dot-bg": `var(--note-${color}-bg)` } as CSSProperties}
          aria-label={colorName(color)}
          aria-pressed={selected === color}
          title={colorName(color)}
          onClick={() => {
            onSelect(color);
          }}
        />
      ))}
    </div>
  );
}
