import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { Check, Copy, Lock, Maximize2, Pencil } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import { shareCopyText, type Note } from "../lib/ipc";
import { cardPreview, parseInline, plainText } from "../lib/markdown";
import { noteToText } from "../lib/noteHtml";
import { FlowText, InlineText, LineRow, NoteLines, NoteTable } from "./NoteText";
import styles from "./NoteCard.module.css";

interface NoteCardProps {
  note: Note;
  onOpen: () => void;
  onUnpin: () => void;
  onExpand: () => void;
  onToggleTask: (line: number) => void;
}

export function noteColorStyle(color: string): CSSProperties {
  return {
    "--note-bg": `var(--note-${color}-bg)`,
    "--note-text": `var(--note-${color}-text)`,
    // Only "none" defines an edge; every other colour falls back to nothing.
    // It is drawn as an inset ring rather than a border so it costs no layout.
    "--note-edge": `var(--note-${color}-edge, transparent)`,
  } as CSSProperties;
}

/** A tool on the card must not also count as a click on the card. */
function stop(event: MouseEvent) {
  event.stopPropagation();
}

function Body({ note, onToggleTask }: Pick<NoteCardProps, "note" | "onToggleTask">) {
  const preview = useMemo(() => cardPreview(note.content), [note.content]);
  const { title, layout, body, hidden } = preview;

  return (
    <>
      {title === null ? (
        <div className={cx(styles.title, styles.untitled)}>New note</div>
      ) : title.kind === "paragraph" && !title.code ? (
        <div className={styles.title}>
          <InlineText text={title.text} />
        </div>
      ) : (
        <LineRow
          line={title}
          code={title.code}
          className={styles.title}
          onToggle={() => {
            onToggleTask(title.index);
          }}
        />
      )}
      {body.length > 0 &&
        (layout === "flow" ? (
          body.some((line) => line.table !== undefined) ? (
            // A table is drawn rather than described, and outside the two-line
            // clamp: the clamp is for a run of words, and it cut the table down
            // to half of its heading row.
            <div className={styles.rows}>
              {body.map((line) =>
                line.table === undefined ? (
                  <div key={line.index} className={styles.preview}>
                    <FlowText lines={[line.text]} />
                  </div>
                ) : (
                  <NoteTable key={line.index} table={line.table} />
                ),
              )}
            </div>
          ) : (
            <div className={styles.preview}>
              <FlowText lines={body.map((line) => line.text)} />
            </div>
          )
        ) : (
          <div className={styles.rows}>
            {body.map((line) =>
              line.table === undefined ? (
                <LineRow
                  key={line.index}
                  line={line}
                  code={line.code}
                  className={styles.row}
                  onToggle={() => {
                    onToggleTask(line.index);
                  }}
                />
              ) : (
                <NoteTable key={line.index} table={line.table} />
              ),
            )}
            {hidden > 0 && (
              <div className={cx(styles.row, styles.more)}>{`${String(hidden)} more`}</div>
            )}
          </div>
        ))}
    </>
  );
}

/**
 * A locked note in full: every line of it, wrapped, with the blank lines still
 * there. Locking a note is how you keep it open in front of you, so it stops
 * being a preview — nothing is cut off at "2 more", and two paragraphs do not
 * run together into one line the way `cardPreview`'s flow layout joins them.
 */
function FullBody({ note, onToggleTask }: Pick<NoteCardProps, "note" | "onToggleTask">) {
  return (
    <NoteLines
      content={note.content}
      titleClassName={styles.fullTitle}
      lineClassName={styles.fullLine}
      fallback={<div className={cx(styles.title, styles.untitled)}>New note</div>}
      onToggle={onToggleTask}
    />
  );
}

/** The accessible name of the card's open button: its title, markers removed. */
function cardLabel(note: Note): string {
  const title = cardPreview(note.content).title;
  return title === null ? "New note" : plainText(parseInline(title.text));
}

/**
 * An unpinned card opens the editor from a click anywhere on it (brief 6.8). It
 * is not a <button>, because a checkbox or a link inside a button is invalid and
 * unreachable; instead a transparent button covers the card, carrying the focus
 * ring and the keyboard path, and the text above it passes clicks through to the
 * card.
 *
 * A pinned one does not open on click. It shows the whole note rather than a
 * preview, its text is selectable so it can be read and copied without touching
 * it, and the only way into the editor is the pencil — the point of pinning a
 * note is that you keep it in front of you and stop editing it by accident.
 */
/** How long the copy button stays ticked, as the code block's does. */
const COPIED_MS = 1_400;

export function NoteCard({ note, onOpen, onUnpin, onExpand, onToggleTask }: NoteCardProps) {
  const [copied, setCopied] = useState(false);
  const expand = (
    <IconButton label="Expand note" className={styles.tool} onClick={onExpand}>
      <Maximize2 size={14} strokeWidth={1.75} />
    </IconButton>
  );

  if (!note.pinned) {
    return (
      <div
        className={cx(styles.card, styles.openable)}
        style={noteColorStyle(note.color)}
        onClick={onOpen}
      >
        <button
          type="button"
          className={styles.cover}
          aria-label={cardLabel(note)}
          // Markers for arrow-key navigation and for restoring focus to this card
          // when its editor closes (brief 6.11). A click on it bubbles to the card.
          data-card=""
          data-id={note.id}
        />
        <div className={styles.text}>
          <Body note={note} onToggleTask={onToggleTask} />
        </div>
        <div className={styles.tools} onClick={stop}>
          {expand}
        </div>
      </div>
    );
  }

  return (
    <div className={cx(styles.card, styles.pinned)} style={noteColorStyle(note.color)}>
      <div className={cx(styles.text, styles.selectable)}>
        <FullBody note={note} onToggleTask={onToggleTask} />
      </div>
      <div className={styles.tools}>
        {/* A locked note is one you read and copy in place, and selecting its
            text is only half of that: the copy key only arrives if the panel
            owns the keyboard, and a panel opened by hover deliberately does not
            (brief 6.3). So there is a button, and it copies through Rust, which
            needs no focus at all. */}
        <IconButton
          label={copied ? "Note copied" : "Copy note"}
          className={styles.tool}
          onClick={() => {
            void shareCopyText(noteToText(note.content))
              .then(() => {
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                }, COPIED_MS);
              })
              .catch((error: unknown) => {
                console.error("notes: could not copy the note", error);
              });
          }}
        >
          {copied ? (
            <Check size={14} strokeWidth={2.25} />
          ) : (
            <Copy size={14} strokeWidth={1.75} />
          )}
        </IconButton>
        {/* Not `active`: accent is reserved for focus rings and Keep open
            (brief 7.1). A lock in the note's own colour says "locked". */}
        <IconButton
          label="Unlock note"
          className={styles.tool}
          pressed
          onClick={onUnpin}
        >
          <Lock size={14} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Edit note"
          className={styles.tool}
          // The keyboard's way in, so arrow keys and Enter still reach a pinned
          // note (brief 6.11) even though the card itself is no longer a button.
          data-card=""
          data-id={note.id}
          onClick={onOpen}
        >
          <Pencil size={14} strokeWidth={1.75} />
        </IconButton>
        {expand}
      </div>
    </div>
  );
}
