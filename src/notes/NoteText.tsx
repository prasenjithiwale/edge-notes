import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Check, Copy, Square, SquareCheck } from "lucide-react";

import { copyText } from "../lib/clipboard";
import { highlight, languageLabel } from "../lib/code";
import { cx } from "../lib/cx";
import { openUrl } from "../lib/ipc";
import { parseBlocks, parseInline, plainText, type Inline, type Line } from "../lib/markdown";
import { splitTags } from "../lib/tags";
import styles from "./NoteText.module.css";

/**
 * Cards sit inside a clickable surface, so anything interactive in the text must
 * keep its click to itself — otherwise ticking a box would also open the editor.
 */
function stop(event: MouseEvent) {
  event.stopPropagation();
}

/**
 * `#tags` inside a run of plain text (idea 16).
 *
 * Not an inline node in `markdown.ts`: the parser's nodes are what the editor
 * writes back, and a node the serialiser would have to reproduce is a way to
 * lose a note. A tag is plain text that is *drawn* differently, so nothing about
 * what is stored changes.
 *
 * Each one is a real button, because `.openable .text :is(a, button)` is what
 * lets something inside a card keep its own click; the panel reads `data-tag`
 * from it rather than every card threading a callback down to here.
 */
function renderText(text: string, key: number): ReactNode {
  const parts = splitTags(text);
  if (parts.length === 1) {
    return <Fragment key={key}>{text}</Fragment>;
  }
  return (
    <Fragment key={key}>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <button
            key={index}
            type="button"
            className={styles.tag}
            data-tag={part.tag}
            title={`Filter by #${part.tag}`}
          >
            {`#${part.tag}`}
          </button>
        ),
      )}
    </Fragment>
  );
}

function renderNodes(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return renderText(node.text, index);
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
      case "code":
        return (
          <code key={index} className={styles.inlineCode}>
            {node.text}
          </code>
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

/** How long the copy button stays ticked before going back to its icon. */
const COPIED_MS = 1_400;

/**
 * A fenced code block: a neutral inset panel with the language on it, the code
 * highlighted, and a button to copy it.
 *
 * It is the one place in the app with colour that is not a note's own (brief 7.1
 * allows the palette and the accent, and the priority flags are the other agreed
 * exception). The reasoning is the same as for the flags: telling a comment from
 * a string from a keyword is what makes a snippet readable at a glance, and
 * nothing but colour does it. Everything is kept inside the block's own surface,
 * which is neutral and the same whatever colour the note is, so the note palette
 * is still the only colour in the note. `contrast.test.ts` holds every role
 * above AA against that surface in both themes.
 */
export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);
  const [copied, setCopied] = useState(false);

  return (
    <div className={styles.code}>
      <div className={styles.codeHead}>
        <span className={styles.codeLang}>{languageLabel(lang)}</span>
        <button
          type="button"
          className={styles.codeCopy}
          aria-label={copied ? "Code copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          onClick={(event) => {
            stop(event);
            void copyText(code).then((ok) => {
              if (!ok) {
                return;
              }
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, COPIED_MS);
            });
          }}
        >
          {copied ? (
            <Check size={13} strokeWidth={2.25} />
          ) : (
            <Copy size={13} strokeWidth={1.75} />
          )}
        </button>
      </div>
      {/* Selectable and not inside the card's click target: code is read and
          copied out, which a surface that swallows the pointer would prevent. */}
      <pre className={styles.codePre} onClick={stop}>
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={styles[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

interface LineRowProps {
  line: Line;
  className?: string | undefined;
  /** Wrap long lines instead of clipping them to one, as the reader does. */
  wrap?: boolean;
  /** A line lifted out of a fenced block: monospace, and never inline-parsed. */
  code?: boolean;
  /** Omit to render ticks as read-only. */
  onToggle?: (() => void) | undefined;
}

/**
 * A list item or paragraph on its own row: marker, then its formatted text.
 *
 * A checkbox here is markdown, not a task. Tasks are their own records since
 * schema v2; a note keeps checkboxes because an ad-hoc list inside a note is
 * useful, and this row no longer reads details out of the text or draws them as
 * chips — that would claim the line is something the Tasks tab knows about.
 */
export function LineRow({
  line,
  className,
  wrap = false,
  code = false,
  onToggle,
}: LineRowProps) {
  const text = line.text;
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
    <div
      className={cx(
        styles.row,
        wrap && styles.wrap,
        // A heading is a heading wherever a note is shown: in the reader, on a
        // locked card, and in the expanded panel. The card's own title class is
        // still applied on top for the first line, which is how a note that
        // opens with plain text keeps reading as having a title.
        line.kind === "heading" && styles[`h${String(line.level)}`],
        className,
      )}
      // Not an <h1>: a note is not a document outline, and a card full of real
      // headings would put a dozen of them into the panel's heading order.
      role={line.kind === "heading" ? "heading" : undefined}
      aria-level={line.kind === "heading" ? line.level : undefined}
    >
      {marker}
      <span
        className={cx(
          styles.rowText,
          code && styles.codeLine,
          line.kind === "task" && line.checked && styles.done,
        )}
      >
        {code ? text : <InlineText text={text} />}
      </span>
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
  const blocks = useMemo(() => parseBlocks(content), [content]);
  // The title is the first line with text on it, and a code block counts: a note
  // that opens with one has no other first line.
  const titleIndex = blocks.findIndex(
    (block) => block.kind === "code" || block.line.text.trim() !== "",
  );

  if (titleIndex === -1) {
    return <>{fallback}</>;
  }

  return (
    <>
      {blocks.map((block, position) => {
        if (block.kind === "code") {
          return <CodeBlock key={block.from} lang={block.lang} code={block.code} />;
        }
        const { line, index } = block;
        if (line.text.trim() === "") {
          // A blank line is a paragraph break, and an empty list item is nothing.
          return <div key={index} className={styles.blank} />;
        }
        return (
          <LineRow
            key={index}
            line={line}
            wrap
            className={position === titleIndex ? titleClassName : lineClassName}
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
