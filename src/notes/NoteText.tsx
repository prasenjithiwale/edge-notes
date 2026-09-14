import { Fragment, useMemo, type MouseEvent, type ReactNode } from "react";
import { Square, SquareCheck } from "lucide-react";

import { cx } from "../lib/cx";
import { openUrl } from "../lib/ipc";
import { parseInline, plainText, type Inline, type Line } from "../lib/markdown";
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
  const label = useMemo(() => plainText(parseInline(line.text)), [line.text]);

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
        <InlineText text={line.text} />
      </span>
    </div>
  );
}
