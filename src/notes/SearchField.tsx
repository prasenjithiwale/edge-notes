import { useEffect, useRef } from "react";

import { useDockStore } from "../store/dock";
import styles from "./SearchField.module.css";

interface SearchFieldProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Focus leaving an empty field returns the header to the title. */
  onAbandon: () => void;
}

/**
 * Replaces the panel title while searching (brief 6.6). It holds the
 * interaction lock while it has focus, so the panel cannot slide away mid-query
 * (brief 6.3) — tied to focus rather than to being mounted, or opening search and
 * walking away would pin the panel open indefinitely. Esc is not handled here: it
 * belongs to the one ordered cascade in the panel (brief 6.11).
 */
export function SearchField({ query, onQueryChange, onAbandon }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const setLock = useDockStore((state) => state.setLock);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(
    // Unmounting while focused may not fire blur, so release the lock here too.
    () => () => {
      setLock("search", false);
    },
    [setLock],
  );

  return (
    <input
      ref={inputRef}
      type="text"
      className={styles.field}
      value={query}
      aria-label="Search notes"
      placeholder="Search notes"
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => {
        onQueryChange(event.target.value);
      }}
      onFocus={() => {
        setLock("search", true);
      }}
      onBlur={() => {
        setLock("search", false);
        if (query.trim() === "") {
          onAbandon();
        }
      }}
    />
  );
}
