import { useEffect, useState, type RefObject } from "react";

import { setBackdrop } from "../lib/ipc";
import styles from "./Panel.module.css";

/** Whether the app is drawing dark: an explicit choice, or the system's. */
function drawingDark(): boolean {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme !== null) {
    return theme === "dark";
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Frost the desktop behind the panel while it is open, and say whether that
 * happened, so the panel can clear its glass only when there is blur behind it.
 *
 * Only once the panel has landed (`open`): the blur is a native view at a fixed
 * place in the window and cannot slide with the panel, so during the slide the
 * glass is drawn nearly solid and clears as it arrives. The rectangle is sent
 * again whenever the panel changes size (the large panel, quick capture) or the
 * theme changes, and taken away the moment closing starts.
 */
export function useBackdrop(ref: RefObject<HTMLElement | null>, open: boolean): boolean {
  const [frosted, setFrosted] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!open || element === null) {
      return;
    }
    let live = true;
    const send = () => {
      const rect = element.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      void setBackdrop({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        radius,
        dark: drawingDark(),
      }).then((ok) => {
        if (live) {
          setFrosted(ok);
        }
      });
    };
    send();

    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(send) : null;
    resize?.observe(element);
    const theme = new MutationObserver(send);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", send);

    return () => {
      live = false;
      resize?.disconnect();
      theme.disconnect();
      media?.removeEventListener("change", send);
      setFrosted(false);
      void setBackdrop(null);
    };
  }, [ref, open]);

  return open && frosted;
}

export type Mood = "idle" | "focus" | "short" | "long";

const MOODS: readonly Mood[] = ["idle", "focus", "short", "long"];

/**
 * The light under the glass. All four moods are always drawn and only the
 * current one is lit, so a change of mood is a cross-fade rather than a swap.
 */
export function Aura({ mood }: { mood: Mood }) {
  return (
    <div className={styles.aura} aria-hidden="true">
      {MOODS.map((each) => (
        <span key={each} data-mood={each} data-on={each === mood ? "" : undefined} />
      ))}
    </div>
  );
}

/** "Wednesday 24 September", in the reader's own language. */
function today(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

/**
 * The view's name in calligraphy, with the date beside it: the panel as a page
 * in a journal. Headline only — nothing here is pressed or read at length.
 */
export function Masthead({ title }: { title: string }) {
  return (
    <div className={styles.masthead}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{today(new Date())}</p>
    </div>
  );
}
