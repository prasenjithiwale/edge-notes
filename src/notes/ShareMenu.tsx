import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileCode, Share } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { withModal } from "../lib/modal";
import {
  shareCopyRich,
  shareCopyText,
  shareSheet,
  shareSheetSupported,
} from "../lib/ipc";
import { buildShare } from "../lib/shareNote";
import { cx } from "../lib/cx";
import styles from "./ShareMenu.module.css";

/** How long "Copied" stays up before the menu closes itself. */
const COPIED_MS = 900;

/**
 * Sending one note somewhere else.
 *
 * Three ways out, because the apps people asked for take three different
 * things: Apple Notes, OneNote, Mail and Word read **HTML** and none of them
 * read Markdown; Obsidian and Bear want the **Markdown** itself; and macOS has
 * its own list of apps, which is the only way to reach Messages or AirDrop.
 *
 * A menu rather than three buttons: the header is 320 px wide and already has
 * four things on it, and sharing is something you do occasionally rather than
 * while writing.
 */
export function ShareMenu({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [hasSheet, setHasSheet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void shareSheetSupported()
      .then(setHasSheet)
      .catch(() => {
        // A system that will not say has no sheet to offer.
        setHasSheet(false);
      });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Judged by where the press started, in the capture phase, like the
    // editor's own click-outside: closing on the way down means the press that
    // closes the menu does not also press what is underneath it.
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const finish = (label: string) => {
    setDone(label);
    setTimeout(() => {
      setDone(null);
      setOpen(false);
    }, COPIED_MS);
  };

  const copyRich = () => {
    void buildShare(content)
      .then((shared) => shareCopyRich(shared.html, shared.text))
      .then(() => {
        finish("Copied");
      })
      .catch((error: unknown) => {
        console.error("share: could not copy as rich text", error);
        finish("Could not copy");
      });
  };

  const copyMarkdown = () => {
    void shareCopyText(content)
      .then(() => {
        finish("Copied");
      })
      .catch((error: unknown) => {
        console.error("share: could not copy as Markdown", error);
        finish("Could not copy");
      });
  };

  const openSheet = () => {
    setOpen(false);
    // The sheet is a window of the system's, in front of the panel: without
    // this the blur it causes would be read as the user leaving (brief 6.3).
    void withModal(async () => {
      const shared = await buildShare(content);
      await shareSheet(shared.text, shared.images);
    }).catch((error: unknown) => {
      console.error("share: could not open the share sheet", error);
    });
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <IconButton
        label="Share note"
        className={styles.button}
        pressed={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Share size={16} strokeWidth={1.75} />
      </IconButton>
      {open && (
        <div className={styles.menu} role="menu" aria-label="Share note">
          {done !== null ? (
            <span className={styles.done}>
              <Check size={13} strokeWidth={2.25} />
              {done}
            </span>
          ) : (
            <>
              <button type="button" role="menuitem" className={styles.item} onClick={copyRich}>
                <Copy size={14} strokeWidth={1.75} />
                <span className={styles.text}>
                  <span>Copy as rich text</span>
                  <span className={styles.hint}>Notes, OneNote, Mail, Word</span>
                </span>
              </button>
              <button type="button" role="menuitem" className={styles.item} onClick={copyMarkdown}>
                <FileCode size={14} strokeWidth={1.75} />
                <span className={styles.text}>
                  <span>Copy as Markdown</span>
                  <span className={styles.hint}>Obsidian, Bear, an editor</span>
                </span>
              </button>
              {hasSheet && (
                <button
                  type="button"
                  role="menuitem"
                  className={cx(styles.item, styles.last)}
                  onClick={openSheet}
                >
                  <Share size={14} strokeWidth={1.75} />
                  <span className={styles.text}>
                    <span>Share…</span>
                    <span className={styles.hint}>The system's own list of apps</span>
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
