import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  DecoratorNode,
  type DOMExportOutput,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import { highlight, LANGUAGES, languageLabel } from "../../lib/code";
import { useSettingsStore } from "../../store/settings";
import { copyText } from "../../lib/clipboard";
import { cx } from "../../lib/cx";
import styles from "./CodeNode.module.css";

export type SerializedCodeNode = Spread<
  { lang: string; code: string },
  SerializedLexicalNode
>;

/** How long the copy button stays ticked before going back to its icon. */
const COPIED_MS = 1_400;

/** Keeps an editing event inside the code block; see the wrapper below. */
function stopEditingEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

/**
 * The code itself: a plain textarea, with the highlighted text painted directly
 * behind it.
 *
 * Why not a read-only block that turns into a field when clicked: clicking would
 * lose the place you clicked. Why not a rich-text block: every rich-text rule is
 * wrong inside code — a Return that starts a paragraph, smart quotes, spell
 * check, autocorrect — and a textarea has none of them.
 *
 * So the textarea is real and keeps its own caret, selection, undo and input
 * method, and its text is transparent; a `<pre>` underneath holds the same text
 * in colour. The two stay aligned because every metric that could move a glyph —
 * font, size, line height, padding, border, tab size, whitespace handling — is
 * set once in `.surface` and shared, and neither wraps. Scrolling is copied from
 * the textarea to the `<pre>` on every scroll event.
 */
function CodeSurface({
  code,
  lang,
  onChange,
}: {
  code: string;
  lang: string;
  onChange: (code: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // Grow to fit rather than scroll vertically: a note is read top to bottom, and
  // a box with its own vertical scrollbar inside one is a trap.
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${String(textarea.scrollHeight)}px`;
    }
  }, []);

  useEffect(resize, [resize, code]);

  const tokens = highlight(code, lang);

  return (
    <div className={styles.stack}>
      <pre ref={preRef} className={cx(styles.surface, styles.paint)} aria-hidden="true">
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={styles[token.kind]}>
              {token.text}
            </span>
          ))}
          {/* A trailing newline has no glyph, so the painted layer would be one
              line shorter than the field and the last line would sit on nothing. */}
          {"\n"}
        </code>
      </pre>
      <textarea
        ref={textareaRef}
        className={cx(styles.surface, styles.field)}
        value={code}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`Code, ${languageLabel(lang)}`}
        rows={1}
        onChange={(event) => {
          onChange(event.target.value);
          resize();
        }}
        onScroll={() => {
          const pre = preRef.current;
          const textarea = textareaRef.current;
          if (pre && textarea) {
            pre.scrollLeft = textarea.scrollLeft;
            pre.scrollTop = textarea.scrollTop;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            // Tab is indentation in code, not the next control.
            event.preventDefault();
            const field = event.currentTarget;
            const { selectionStart, selectionEnd, value } = field;
            const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
            onChange(next);
            requestAnimationFrame(() => {
              field.setSelectionRange(selectionStart + 2, selectionStart + 2);
            });
          }
        }}
      />
    </div>
  );
}

/**
 * The block: a language dropdown, a copy button, a way to remove it, and the
 * code. The dropdown is the whole list in one control rather than a row of
 * chips shown before anything has been typed — the language is a property of a
 * block that exists, not a question to answer first.
 */
function CodeBlockEditor({ nodeKey, editor }: { nodeKey: NodeKey; editor: LexicalEditor }) {
  const [lang, setLang] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  // The node is the source of truth; this mirrors it so typing is local and the
  // editor state is updated from here rather than the other way round.
  useEffect(
    () =>
      editor.registerUpdateListener(() => {
        editor.getEditorState().read(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isCodeNode(node)) {
            setLang(node.getLang());
            setCode(node.getCode());
          }
        });
      }),
    [editor, nodeKey],
  );

  // And the first read, before anything has changed.
  useEffect(() => {
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isCodeNode(node)) {
        setLang(node.getLang());
        setCode(node.getCode());
      }
    });
  }, [editor, nodeKey]);

  const write = (change: (node: CodeNode) => void) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isCodeNode(node)) {
        change(node);
      }
    });
  };

  return (
    <div
      className={styles.block}
      // The block is inside the editor's root element, so everything that
      // happens in the textarea bubbles up to the listeners Lexical has there.
      // Lexical marks a decorator `contenteditable="false"` and mostly ignores
      // it, but a typed character reaching its input handling would be a
      // character it tries to reconcile into a node that does not hold text. So
      // the whole of the editing conversation stops here.
      //
      // Escape is the exception: closing the editor is the panel's to decide
      // (brief 6.11's one ordered cascade), and that listener is on the window.
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          event.stopPropagation();
        }
      }}
      onKeyUp={stopEditingEvent}
      onBeforeInput={stopEditingEvent}
      onInput={stopEditingEvent}
      onPaste={stopEditingEvent}
      onCut={stopEditingEvent}
      onCopy={stopEditingEvent}
      onCompositionStart={stopEditingEvent}
      onCompositionEnd={stopEditingEvent}
    >
      <div className={styles.head}>
        <span className={styles.select}>
          <select
            className={styles.language}
            aria-label="Code language"
            value={lang}
            onChange={(event) => {
              const next = event.target.value;
              setLang(next);
              write((node) => {
                node.setLang(next);
              });
              // Remembered the way the note colour is, so the next block opens
              // in the language the last one ended in.
              void useSettingsStore.getState().patch({ "notes.lastCodeLang": next });
            }}
          >
            <option value="">Plain text</option>
            {LANGUAGES.map((language) => (
              <option key={language.id} value={language.id}>
                {language.label}
              </option>
            ))}
          </select>
        </span>
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            aria-label={copied ? "Code copied" : "Copy code"}
            title={copied ? "Copied" : "Copy code"}
            onClick={() => {
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
            {copied ? <Check size={13} strokeWidth={2.25} /> : <Copy size={13} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            className={styles.action}
            aria-label="Remove code block"
            title="Remove code block"
            onClick={() => {
              write((node) => {
                node.remove();
              });
            }}
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <CodeSurface
        code={code}
        lang={lang}
        onChange={(next) => {
          setCode(next);
          write((node) => {
            node.setCode(next);
          });
        }}
      />
    </div>
  );
}

/** Reads the editor out of context, so the node itself stays free of React. */
function CodeBlockDecorator({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  return <CodeBlockEditor nodeKey={nodeKey} editor={editor} />;
}

/**
 * A fenced code block, as one node in the note rather than a run of lines.
 *
 * A `DecoratorNode` is Lexical's word for a block it makes room for but does not
 * edit; what fills the room is the component above. The node knows only its
 * language and its text, so serialising a note never has to read the DOM.
 */
export class CodeNode extends DecoratorNode<ReactNode> {
  __lang: string;
  __code: string;

  static getType(): string {
    return "ledge-code";
  }

  static clone(node: CodeNode): CodeNode {
    return new CodeNode(node.__lang, node.__code, node.__key);
  }

  constructor(lang = "", code = "", key?: NodeKey) {
    super(key);
    this.__lang = lang;
    this.__code = code;
  }

  static importJSON(serialized: SerializedCodeNode): CodeNode {
    return new CodeNode(serialized.lang, serialized.code);
  }

  exportJSON(): SerializedCodeNode {
    return { ...super.exportJSON(), lang: this.__lang, code: this.__code };
  }

  /** Copying a block out of the note puts its text on the clipboard. */
  exportDOM(): DOMExportOutput {
    const pre = document.createElement("pre");
    pre.textContent = this.__code;
    return { element: pre };
  }

  createDOM(): HTMLElement {
    return document.createElement("div");
  }

  updateDOM(): false {
    return false;
  }

  getLang(): string {
    return this.getLatest().__lang;
  }

  setLang(lang: string): void {
    this.getWritable().__lang = lang;
  }

  getCode(): string {
    return this.getLatest().__code;
  }

  setCode(code: string): void {
    this.getWritable().__code = code;
  }

  /** What a plain-text copy of the note contains for this block. */
  getTextContent(): string {
    return this.__code;
  }

  isInline(): false {
    return false;
  }

  decorate(): ReactNode {
    return <CodeBlockDecorator nodeKey={this.getKey()} />;
  }
}

export function $createCodeNode(lang = "", code = ""): CodeNode {
  return new CodeNode(lang, code);
}

export function $isCodeNode(node: LexicalNode | null | undefined): node is CodeNode {
  return node instanceof CodeNode;
}
