import type { MouseEvent, ReactNode } from "react";

import { cx } from "../lib/cx";
import styles from "./IconButton.module.css";

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  outlined?: boolean;
  pressed?: boolean;
  className?: string | undefined;
  /** Shown in the tooltip after the label, e.g. "⌘B". */
  shortcut?: string | undefined;
  /**
   * Leave keyboard focus where it is. The formatting buttons act on the text
   * selection, which would be gone by the time the click landed if pressing the
   * button moved focus off the textarea.
   */
  keepFocus?: boolean;
  /** Marks this button as an arrow-key navigation target (brief 6.11). */
  "data-card"?: string;
  "data-id"?: string;
}

/** Every icon button carries a tooltip and an aria-label (brief 6.6). */
export function IconButton({
  label,
  onClick,
  children,
  active = false,
  outlined = false,
  pressed,
  className,
  shortcut,
  keepFocus = false,
  ...markers
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        styles.button,
        active && styles.active,
        outlined && styles.outlined,
        className,
      )}
      aria-label={label}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      {...(keepFocus
        ? {
            onMouseDown: (event: MouseEvent) => {
              event.preventDefault();
            },
          }
        : {})}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...markers}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
