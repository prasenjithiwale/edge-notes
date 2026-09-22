import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { TextNode } from "lexical";

import { cx } from "../../lib/cx";
import { FORMAT_SHORTCUTS, shortcutLabel } from "../formatting";
import { runCommand, useToolbarState, type FormatCommand } from "./toolbar";
import styles from "./SlashMenu.module.css";

/**
 * One thing the menu can turn the line into.
 *
 * `keywords` are what someone types instead of the name — "todo" for a checklist,
 * "ul" for bullets. They are matched as well as the label, so the menu finds what
 * you mean rather than only what it is called.
 */
/**
 * Whether an item changes what the line *is* or how the text *looks*. The two
 * are different enough to be worth a heading between them, and a menu that only
 * matched marks should not be headed "Turn into".
 */
type Group = "block" | "mark";

const GROUP_LABELS: Record<Group, string> = {
  block: "Turn into",
  mark: "Format",
};

class BlockOption extends MenuOption {
  constructor(
    readonly command: FormatCommand,
    readonly group: Group,
    readonly label: string,
    readonly hint: string,
    readonly keywords: readonly string[],
    readonly Icon: LucideIcon,
  ) {
    super(label);
  }

  /** The key that does the same thing, shown as the platform writes it. */
  get shortcut(): string | null {
    const match = FORMAT_SHORTCUTS.find((item) => item.command === this.command);
    return match === undefined ? null : shortcutLabel(match);
  }

  matches(query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return true;
    }
    return (
      this.label.toLowerCase().includes(needle) ||
      this.keywords.some((keyword) => keyword.startsWith(needle))
    );
  }
}

/**
 * Everything the menu offers, in the order it offers it: the plain paragraph
 * first, because it is the way back from all the others, then the three lists in
 * the order the toolbar has them, then code.
 *
 * This is exactly what the note's storage format can express. A menu item that
 * wrote something the Markdown dialect cannot hold would be lost on the next
 * save, so there is no Heading here yet — that needs the dialect to learn `#`
 * first, and is a change to how every existing note is read.
 */
const BLOCKS: readonly BlockOption[] = [
  new BlockOption("text", "block", "Text", "Plain paragraph", ["paragraph", "plain", "body"], Type),
  new BlockOption("heading1", "block", "Heading 1", "A note's title", ["h1", "title", "heading"], Heading1),
  new BlockOption("heading2", "block", "Heading 2", "A section", ["h2", "section", "heading"], Heading2),
  new BlockOption("heading3", "block", "Heading 3", "A smaller section", ["h3", "heading"], Heading3),
  new BlockOption("task", "block", "To-do list", "Tick things off", ["todo", "task", "check", "box"], ListChecks),
  new BlockOption("bullet", "block", "Bulleted list", "A simple list", ["ul", "unordered", "bullet"], List),
  new BlockOption("ordered", "block", "Numbered list", "A list in order", ["ol", "number", "step"], ListOrdered),
  new BlockOption("codeblock", "block", "Code block", "With a language of its own", ["code", "snippet", "pre"], Braces),
  // The one item that opens a window of its own. It is a block rather than a
  // mark because what it adds is a thing on the line, not a way of writing one.
  new BlockOption("image", "block", "Image", "A picture from a file", ["image", "picture", "photo", "img", "screenshot"], Image),
  // The marks apply to the selection, or to whatever is typed next when there
  // is none — which is the case the moment after `/bold` has been picked.
  new BlockOption("bold", "mark", "Bold", "Heavier text", ["strong", "b"], Bold),
  new BlockOption("italic", "mark", "Italic", "Slanted text", ["em", "i", "oblique"], Italic),
  new BlockOption("strike", "mark", "Strikethrough", "Crossed out", ["strike", "s", "cross"], Strikethrough),
  new BlockOption("code", "mark", "Code", "A word in monospace", ["inline", "mono", "tick"], Code),
];

/**
 * Notion's slash menu: type `/` and the line becomes whatever you pick.
 *
 * The typing, the filtering, the arrow keys and the anchoring are Lexical's
 * (`LexicalTypeaheadMenuPlugin`); what is here is which blocks exist, how they
 * are matched, and what they look like. Escape closes the menu and goes no
 * further — the plugin stops the event itself, so the panel's own Escape
 * cascade (brief 6.11) never sees it and the editor stays open.
 */
export function SlashMenuPlugin({ lang }: { lang: string }) {
  const [editor] = useLexicalComposerContext();
  const toolbar = useToolbarState(editor);
  const [query, setQuery] = useState<string | null>(null);

  // `/` on its own opens it, so the menu is a list to browse rather than a
  // prefix to guess at.
  const trigger = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });

  // Memoised on the query: the plugin takes this as a prop, and a fresh array
  // every render is how the editor was made to loop once before.
  const options = useMemo(() => BLOCKS.filter((block) => block.matches(query ?? "")), [query]);

  const onSelect = useCallback(
    (option: BlockOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        // The `/todo` that was typed is not part of the note.
        nodeToRemove?.remove();
      });
      runCommand(editor, option.command, toolbar, lang);
      closeMenu();
    },
    [editor, toolbar, lang],
  );

  return (
    <LexicalTypeaheadMenuPlugin<BlockOption>
      onQueryChange={setQuery}
      onSelectOption={onSelect}
      triggerFn={trigger}
      options={options}
      anchorClassName={styles.anchor ?? ""}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (anchorRef.current === null || options.length === 0) {
          return null;
        }
        return createPortal(
          <ul className={styles.menu} role="listbox" aria-label="Slash commands">
            {options.map((option, index) => (
              <li key={option.key} role="presentation">
                {/* A heading whenever the kind changes, so a filtered menu that
                    happens to be all marks is not headed "Turn into". */}
                {options[index - 1]?.group !== option.group && (
                  <span className={styles.section}>{GROUP_LABELS[option.group]}</span>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={cx(styles.item, index === selectedIndex && styles.selected)}
                  ref={(element) => {
                    option.setRefElement(element);
                  }}
                  // The caret must stay in the note: the block goes where it is.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onMouseEnter={() => {
                    setHighlightedIndex(index);
                  }}
                  onClick={() => {
                    setHighlightedIndex(index);
                    selectOptionAndCleanUp(option);
                  }}
                >
                  <option.Icon className={styles.icon} size={15} strokeWidth={1.75} />
                  <span className={styles.text}>
                    <span className={styles.label}>{option.label}</span>
                    <span className={styles.hint}>{option.hint}</span>
                  </span>
                  {/* The key that does the same thing, for anyone who would
                      rather not come back through the menu next time. */}
                  {option.shortcut !== null && (
                    <span className={styles.key}>{option.shortcut}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>,
          anchorRef.current,
        );
      }}
    />
  );
}

export { BLOCKS };
