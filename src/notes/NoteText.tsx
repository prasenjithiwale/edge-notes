import { Fragment, useMemo, type MouseEvent, type ReactNode } from "react";
import { Flag, Repeat, Square, SquareCheck } from "lucide-react";

import { cx } from "../lib/cx";
import { openUrl } from "../lib/ipc";
import { parseInline, parseLine, plainText, type Inline, type Line } from "../lib/markdown";
import {
  dueLabel,
  dueSection,
  parseTaskText,
  priorityLabel,
  repeatLabel,
  type TaskMeta,
} from "../lib/taskMeta";
import { useNow } from "../lib/useNow";
import styles from "./NoteText.module.css";

/**
 * Cards sit inside a clickable surface, so anything interactive in the text must
 * keep its click to itself — otherwise ticking a box would also open the editor.
 */
function stop(event: MouseEvent) {
  event.stopPropagation();
}

function renderNodes(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "bold":
        return (
          <strong key={index} className={styles.bold}>
            {renderNodes(node.children)}
          </strong>
        );
      case "italic":
        return (
          <em key={index} className={styles.italic}>
            {renderNodes(node.children)}
          </em>
        );
      case "strike":
        return (
          <s key={index} className={styles.strike}>
            {renderNodes(node.children)}
          </s>
        );
      case "link":
        return (
          <a
            key={index}
            className={styles.link}
            href={node.url}
            title={node.url}
            onClick={(event) => {
              // Never navigate the widget's own webview; hand the link to the
              // browser instead.
              event.preventDefault();
              stop(event);
              void openUrl(node.url);
            }}
          >
            {node.url}
          </a>
        );
    }
  });
}

/** One line of inline formatting. */
export function InlineText({ text }: { text: string }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <>{renderNodes(nodes)}</>;
}

/** Several lines joined into one run of text, as a paragraph preview flows. */
export function FlowText({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && " "}
          <InlineText text={line} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * A task's details as small chips after its text: a flag for priority, the due
 * date, and a repeat mark. Neutral, in the text's own colour — colour belongs to
 * notes (brief 7.1) — with an overdue date carried by weight instead.
 */
export function TaskChips({ meta, checked }: { meta: TaskMeta; checked: boolean }) {
  const now = useNow();
  if (meta.priority === null && meta.due === null && meta.repeat === null) {
    return null;
  }
  const overdue = !checked && meta.due !== null && dueSection(meta.due, new Date(now)) === "overdue";
  return (
    <span className={styles.chips}>
      {meta.priority !== null && (
        <span
          className={cx(styles.chip, styles[`priority-${meta.priority}`])}
          title={`${priorityLabel(meta.priority)} priority`}
          aria-label={`${priorityLabel(meta.priority)} priority`}
        >
          <Flag
            size={11}
            strokeWidth={2}
            fill={meta.priority === "high" ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </span>
      )}
      {meta.due !== null && (
        <span
          className={cx(styles.chip, overdue && styles.overdue)}
          title={overdue ? "Overdue" : "Due"}
        >
          {dueLabel(meta.due, new Date(now))}
        </span>
      )}
      {meta.repeat !== null && (
        <span
          className={styles.chip}
          title={`Repeats ${repeatLabel(meta.repeat).toLowerCase()}`}
          aria-label={`Repeats ${repeatLabel(meta.repeat).toLowerCase()}`}
        >
          <Repeat size={11} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

interface LineRowProps {
  line: Line;
  className?: string | undefined;
  /** Wrap long lines instead of clipping them to one, as the reader does. */
  wrap?: boolean;
  /** Omit to render ticks as read-only. */
  onToggle?: (() => void) | undefined;
}

/** A list item or paragraph on its own row: marker, then its formatted text. */
export function LineRow({ line, className, wrap = false, onToggle }: LineRowProps) {
  // A task's details are tokens at the end of its text; the row shows its title
  // and draws the details as chips.
  const meta = useMemo(
    () => (line.kind === "task" ? parseTaskText(line.text) : null),
    [line.kind, line.text],
  );
  const text = meta === null ? line.text : meta.title;
  const label = useMemo(() => plainText(parseInline(text)), [text]);

  let marker: ReactNode = null;
  if (line.kind === "bullet") {
    marker = (
      <span className={styles.marker} aria-hidden="true">
        •
      </span>
    );
  } else if (line.kind === "ordered") {
    marker = (
      <span className={styles.marker}>{`${String(line.number)}${line.marker}`}</span>
    );
  } else if (line.kind === "task") {
    const Icon = line.checked ? SquareCheck : Square;
    marker = (
      <button
        type="button"
        role="checkbox"
        className={styles.checkbox}
        aria-checked={line.checked}
        aria-label={label}
        disabled={onToggle === undefined}
        onClick={(event) => {
          stop(event);
          onToggle?.();
        }}
      >
        <Icon size={14} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div className={cx(styles.row, wrap && styles.wrap, className)}>
      {marker}
      <span className={cx(styles.rowText, line.kind === "task" && line.checked && styles.done)}>
        <InlineText text={text} />
      </span>
      {meta !== null && <TaskChips meta={meta} checked={line.checked} />}
    </div>
  );
}

interface NoteLinesProps {
  content: string;
  /** Class for the first line with text on it, the one that reads as the title. */
  titleClassName?: string | undefined;
  lineClassName?: string | undefined;
  /** Rendered instead when the note has no text at all, so nothing shows blank. */
  fallback?: ReactNode;
  /** Omit to render ticks as read-only. Takes the line's index in the content. */
  onToggle?: ((index: number) => void) | undefined;
}

/**
 * A whole note, formatted: every line in the order it was written, wrapped
 * rather than clipped, and blank lines kept as the paragraph breaks they are.
 * The reader and a locked card both show a note this way, so what is on screen
 * is what was typed — nothing dropped, nothing run together.
 *
 * This is the opposite of `cardPreview`, which an ordinary card uses to fit a
 * note into a couple of lines. Keep the two apart: a preview may take liberties
 * with the text, and this may not.
 */
export function NoteLines({
  content,
  titleClassName,
  lineClassName,
  fallback = null,
  onToggle,
}: NoteLinesProps) {
  const lines = useMemo(() => content.split("\n").map(parseLine), [content]);
  // Indices are into the content, so a tick still finds its own line.
  const titleIndex = lines.findIndex((line) => line.text.trim() !== "");

  if (titleIndex === -1) {
    return <>{fallback}</>;
  }

  return (
    <>
      {lines.map((line, index) => {
        if (line.text.trim() === "") {
          // A blank line is a paragraph break, and an empty list item is nothing.
          return <div key={index} className={styles.blank} />;
        }
        return (
          <LineRow
            key={index}
            line={line}
            wrap
            className={index === titleIndex ? titleClassName : lineClassName}
            onToggle={
              onToggle === undefined
                ? undefined
                : () => {
                    onToggle(index);
                  }
            }
          />
        );
      })}
    </>
  );
}
