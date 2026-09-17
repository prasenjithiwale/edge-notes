import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {
  Bold,
  Braces,
  Code,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Maximize2,
  Minimize2,
  Palette,
  Lock,
  LockOpen,
  Strikethrough,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import { CLASSIC_COLORS, NOTE_COLORS, type Note, type NoteColor } from "../lib/ipc";
import { prefersReducedMotion } from "../lib/motion";
import { colorName, editedLabel, quickColors } from "../lib/notes";
import { useNow } from "../lib/useNow";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { useSettingsStore } from "../store/settings";
import { noteColorStyle } from "./NoteCard";
import { FORMAT_SHORTCUTS, shortcutLabel } from "./formatting";
import { EDITOR_NODES, EDITOR_THEME } from "./editor/config";
import { ChangePlugin, FocusPlugin, LoadPlugin, ShortcutPlugin } from "./editor/plugins";
import { LINK_MATCHERS, NOTE_TRANSFORMERS } from "./editor/shortcuts";
import { isActive, runCommand, useToolbarState, type FormatCommand } from "./editor/toolbar";
import editorStyles from "./editor/RichEditor.module.css";
import styles from "./NoteEditor.module.css";

interface NoteEditorProps {
  note: Note;
  /** Filling the large panel: no expand animation and no height cap. */
  large?: boolean;
}

const FORMAT_ICONS: Record<FormatCommand, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code,
  bullet: List,
  ordered: ListOrdered,
  task: ListChecks,
  codeblock: Braces,
};

/**
 * Text styles, then lists: two groups, separated by space rather than a rule.
 * The code block is not in either — it opens a language picker rather than
 * toggling something, and it is drawn beside them from the editor itself.
 */
const FORMAT_GROUPS: readonly (readonly FormatCommand[])[] = [
  ["bold", "italic", "strike", "code"],
  ["bullet", "ordered", "task"],
];

/** Brief 6.9: the card expands in place over this long. */
const EXPAND_MS = 160;

/**
 * Where the expansion starts from: about the height of the card that was just
 * replaced. Measuring the outgoing card would mean threading its height through
 * the list for a 160 ms animation; a close-enough constant keeps the growth
 * visible without that.
 */
const CARD_HEIGHT_GUESS = 64;

export function NoteEditor({ note, large = false }: NoteEditorProps) {
  return (
    <LexicalComposer
      key={note.id}
      initialConfig={{
        namespace: "note",
        nodes: [...EDITOR_NODES],
        theme: EDITOR_THEME,
        // A note is never worth losing to a render error: the editor reports it
        // and carries on with the text it has.
        onError: (error: Error) => {
          console.error("editor:", error);
        },
      }}
    >
      <NoteEditorBody note={note} large={large} />
    </LexicalComposer>
  );
}

function NoteEditorBody({ note, large = false }: NoteEditorProps) {
  const [editor] = useLexicalComposerContext();
  const toolbar = useToolbarState(editor);
  const rootRef = useRef<HTMLElement>(null);
  const setContent = useNotesStore((state) => state.setContent);
  const setColor = useNotesStore((state) => state.setColor);
  const stopEditing = useNotesStore((state) => state.stopEditing);
  const remove = useNotesStore((state) => state.remove);
  const setPinned = useNotesStore((state) => state.setPinned);
  const expand = useNotesStore((state) => state.expand);
  const shrink = useNotesStore((state) => state.shrink);
  const setLock = useDockStore((state) => state.setLock);
  const now = useNow();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const lastLang = useSettingsStore((state) => state.settings["notes.lastCodeLang"]);
  // Chosen once, when the editor opens: picking a colour must not reshuffle the
  // row under the cursor. A colour picked from the full palette joins it.
  const [quick] = useState(() =>
    quickColors(note.color, useNotesStore.getState().notes, NOTE_COLORS, CLASSIC_COLORS),
  );
  const shownColors = NOTE_COLORS.filter(
    (color) => quick.includes(color) || color === note.color,
  );

  // Brief 6.9: the card expands in place rather than being swapped for a taller
  // box. Animating `max-height` from roughly the card's height to the editor's
  // own, then letting go of the constraint — it has to be released, or the
  // editor could not grow as you type.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || large || prefersReducedMotion()) {
      return;
    }

    const target = root.scrollHeight;
    const start = Math.min(target, CARD_HEIGHT_GUESS);
    root.style.overflow = "hidden";
    root.style.maxHeight = `${String(start)}px`;

    const frame = requestAnimationFrame(() => {
      root.style.transition = `max-height ${String(EXPAND_MS)}ms var(--open-easing)`;
      root.style.maxHeight = `${String(target)}px`;
    });

    const release = () => {
      root.style.maxHeight = "";
      root.style.transition = "";
      root.style.overflow = "";
    };
    // Whichever comes first: the transition, or a timer in case it never fires.
    const timer = setTimeout(release, EXPAND_MS + 60);
    root.addEventListener("transitionend", release, { once: true });

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      root.removeEventListener("transitionend", release);
      release();
    };
  }, [large]);

  // A click outside the note leaves the editor when nothing was typed (owner's
  // request). Judged by where the press *started*: a text selection dragged from
  // inside the note and released outside is not a click outside. Capture
  // phase, so it runs before whatever was clicked reacts — a card's click then
  // opens that card cleanly after this editor has closed.
  useEffect(() => {
    let pressedOutside = false;
    const isOutside = (target: EventTarget | null) =>
      target instanceof Node && !rootRef.current?.contains(target);
    const onPointerDown = (event: Event) => {
      pressedOutside = isOutside(event.target);
    };
    const onClick = (event: Event) => {
      if (pressedOutside && isOutside(event.target)) {
        void useNotesStore.getState().leaveEditorIfUnchanged();
      }
      pressedOutside = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    // Hold the panel open while the editor is open (brief 6.3). Counted in the
    // store, because the search field can hold the same lock.
    setLock("editor", true);
    return () => {
      setLock("editor", false);
    };
  }, [setLock]);

  const format = (command: FormatCommand, lang?: string) => {
    runCommand(editor, command, toolbar, lang ?? lastLang);
  };

  // Every change is written to the store as Markdown, which is what the card
  // renders and what the autosave debounce eventually writes to the database.
  const onChangeContent = useCallback(
    (markdown: string) => {
      setContent(note.id, markdown);
    },
    [setContent, note.id],
  );

  const codeShortcut = FORMAT_SHORTCUTS.find((item) => item.command === "codeblock");

  return (
    <section
      ref={rootRef}
      className={cx(styles.editor, large && styles.large)}
      style={noteColorStyle(note.color)}
    >
      <div className={styles.toolbar}>
        <div className={styles.formatting} role="toolbar" aria-label="Formatting">
          {FORMAT_GROUPS.map((group, index) => (
            <div key={index} className={styles.group}>
              {group.map((command) => {
                const shortcut = FORMAT_SHORTCUTS.find((item) => item.command === command);
                const Icon = FORMAT_ICONS[command];
                const on = isActive(command, toolbar);
                return (
                  <IconButton
                    key={command}
                    label={shortcut?.label ?? command}
                    shortcut={shortcut ? shortcutLabel(shortcut) : undefined}
                    className={styles.footerButton}
                    // A rich editor's toolbar is a readout as well as a set of
                    // buttons: lit means the caret is already in it.
                    active={on}
                    pressed={on}
                    keepFocus
                    onClick={() => {
                      format(command);
                    }}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </IconButton>
                );
              })}
            </div>
          ))}
          {/* Its own group: it inserts a block rather than marking up what is
              already there, and the language is a dropdown on the block. */}
          <div className={styles.group}>
            <IconButton
              label="Code block"
              shortcut={codeShortcut ? shortcutLabel(codeShortcut) : undefined}
              className={styles.footerButton}
              keepFocus
              onClick={() => {
                format("codeblock");
              }}
            >
              <Braces size={16} strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>
        <IconButton
          label={large ? "Shrink note" : "Expand note"}
          className={styles.footerButton}
          keepFocus
          onClick={() => {
            if (large) {
              shrink();
            } else {
              void expand(note.id, { edit: true });
            }
          }}
        >
          {large ? (
            <Minimize2 size={16} strokeWidth={1.75} />
          ) : (
            <Maximize2 size={16} strokeWidth={1.75} />
          )}
        </IconButton>
      </div>
      <div className={styles.body}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={editorStyles.editable}
              aria-label="Note content"
              aria-placeholder="Write a note"
              placeholder={<div className={styles.placeholder}>Write a note</div>}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <LoadPlugin noteId={note.id} content={note.content} />
        <ChangePlugin content={note.content} onChange={onChangeContent} />
        <FocusPlugin />
        <ShortcutPlugin lang={lastLang} />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <AutoLinkPlugin matchers={[...LINK_MATCHERS]} />
        <MarkdownShortcutPlugin transformers={[...NOTE_TRANSFORMERS]} />
      </div>
      <div className={styles.swatches} role="group" aria-label="Note colour">
        {shownColors.map((color) => (
          <Swatch
            key={color}
            color={color}
            selected={color === note.color}
            onPick={() => {
              void setColor(note.id, color);
            }}
          />
        ))}
        <IconButton
          label="More colours"
          className={cx(styles.footerButton, styles.paletteButton)}
          pressed={paletteOpen}
          keepFocus
          onClick={() => {
            setPaletteOpen((open) => !open);
          }}
        >
          <Palette size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      {paletteOpen && (
        <div className={styles.palette} role="group" aria-label="All colours">
          {NOTE_COLORS.map((color) => (
            <Swatch
              key={color}
              color={color}
              selected={color === note.color}
              onPick={() => {
                void setColor(note.id, color);
                setPaletteOpen(false);
              }}
            />
          ))}
        </div>
      )}
      <footer className={styles.footer}>
        <span className={styles.meta}>{editedLabel(note.updatedAt, now)}</span>
        <IconButton
          // A pinned note is locked: it sorts first and opens read-only. Shown as
          // a lock (owner's request) so it no longer shares the pin with Keep
          // open; not accent-coloured, which is reserved for focus rings and
          // Keep open (brief 7.1).
          label={note.pinned ? "Unlock note" : "Lock note"}
          className={styles.footerButton}
          pressed={note.pinned}
          onClick={() => {
            void setPinned(note.id, !note.pinned);
          }}
        >
          {note.pinned ? (
            <Lock size={16} strokeWidth={1.75} />
          ) : (
            <LockOpen size={16} strokeWidth={1.75} />
          )}
        </IconButton>
        <IconButton
          label="Delete note"
          className={styles.footerButton}
          onClick={() => {
            void remove(note.id);
          }}
        >
          <Trash2 size={16} strokeWidth={1.75} />
        </IconButton>
        <button
          type="button"
          className={styles.done}
          onClick={() => {
            void stopEditing();
          }}
        >
          Done
        </button>
      </footer>
    </section>
  );
}

interface SwatchProps {
  color: NoteColor;
  selected: boolean;
  onPick: () => void;
}

function Swatch({ color, selected, onPick }: SwatchProps) {
  return (
    <button
      type="button"
      className={cx(styles.swatch, selected && styles.swatchSelected)}
      style={{ "--swatch-bg": `var(--note-${color}-bg)` } as CSSProperties}
      aria-label={colorName(color)}
      aria-pressed={selected}
      title={colorName(color)}
      // The palette sits under the textarea; keep the caret where it was.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onPick}
    />
  );
}
