import type { ReactNode } from "react";

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
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
