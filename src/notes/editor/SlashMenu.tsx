import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, List, ListChecks, ListOrdered, Type, type LucideIcon } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { TextNode } from "lexical";

import { cx } from "../../lib/cx";
import { runCommand, useToolbarState, type FormatCommand } from "./toolbar";
import styles from "./SlashMenu.module.css";

/**
 * One thing the menu can turn the line into.
 *
 * `keywords` are what someone types instead of the name — "todo" for a checklist,
 * "ul" for bullets. They are matched as well as the label, so the menu finds what
 * you mean rather than only what it is called.
 */
class BlockOption extends MenuOption {
  constructor(
    readonly command: FormatCommand,
    readonly label: string,
    readonly hint: string,
    readonly keywords: readonly string[],
    readonly Icon: LucideIcon,
  ) {
    super(label);
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
  new BlockOption("text", "Text", "Plain paragraph", ["paragraph", "plain", "body"], Type),
  new BlockOption("task", "To-do list", "Tick things off", ["todo", "task", "check", "box"], ListChecks),
  new BlockOption("bullet", "Bulleted list", "A simple list", ["ul", "unordered", "bullet"], List),
  new BlockOption("ordered", "Numbered list", "A list in order", ["ol", "number", "step"], ListOrdered),
  new BlockOption("codeblock", "Code block", "With a language of its own", ["code", "snippet", "pre"], Braces),
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
          <ul className={styles.menu} role="listbox" aria-label="Turn this line into">
            {options.map((option, index) => (
              <li key={option.key} role="presentation">
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
