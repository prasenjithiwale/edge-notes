import { useCallback, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
} from "lexical";

import { formatCommandForKey } from "../formatting";
import { IMAGE_PREFIX } from "../../lib/images";
import { imagesSave, onImagesDropped } from "../../lib/ipc";
import { $createImageNode } from "./ImageNode";
import { $setFromMarkdown, $toMarkdown } from "./markdown";
import { runCommand, useToolbarState } from "./toolbar";

/**
 * Where an editor's state was when it last unmounted.
 *
 * Expanding or shrinking a note swaps one editor for another, and without this
 * the caret would jump to the end of a long note at the moment someone wanted a
 * better look at it. The whole editor state is kept, not just an offset, because
 * it already carries the selection and restores in one call.
 */
const memory = { id: "", content: "", state: "", at: 0 };

/** Long enough to span the swap; short enough that reopening a note later does not count. */
const MEMORY_MS = 1_000;

/**
 * Put the note into the editor, once, and remember where it was left.
 *
 * It never writes back: the change plugin owns that direction. Loading a note
 * and saving it must not be the same event, or opening a note would touch it.
 */
export function LoadPlugin({ noteId, content }: { noteId: string; content: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // The text is part of the key, not just the note: restoring a state that was
    // serialised from different text would put back what the note no longer
    // says — after an undone delete, say, or a change made in another window.
    const restoring =
      memory.id === noteId &&
      memory.content === content &&
      memory.state !== "" &&
      Date.now() - memory.at < MEMORY_MS;

    if (restoring) {
      editor.setEditorState(editor.parseEditorState(memory.state));
    } else {
      editor.update(
        () => {
          $setFromMarkdown(content);
          // Caret at the end, so typing continues rather than overwrites.
          $getRoot().selectEnd();
        },
        { tag: "history-merge" },
      );
    }

    return () => {
      memory.id = noteId;
      memory.content = editor.getEditorState().read($toMarkdown);
      memory.state = JSON.stringify(editor.getEditorState().toJSON());
      memory.at = Date.now();
    };
    // The note's text is read once, when the editor opens for it: after that the
    // editor is the newer copy and the store follows it, not the other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  return null;
}

/**
 * The editor's text back out as Markdown, on every change that is not just the
 * caret moving.
 *
 * The first change after loading is the load itself, and writing then would mark
 * a note edited for having been opened, so an unchanged serialisation is
 * dropped.
 */
export function ChangePlugin({
  content,
  onChange,
}: {
  content: string;
  onChange: (markdown: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // What this plugin last wrote, seeded with what it was given. Not kept in step
  // with the prop: while the editor is open it is the newer copy, and the store
  // follows it rather than the other way round.
  const latest = useRef(content);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
          return;
        }
        const markdown = editorState.read($toMarkdown);
        if (markdown !== latest.current) {
          latest.current = markdown;
          onChange(markdown);
        }
      }),
    [editor, onChange],
  );

  return null;
}

/**
 * The editor can mount before the window has the keyboard — the shortcut opens
 * the panel and asks for a new note in the same breath, and focusing an element
 * in a window that is not yet key does not stick. Re-focus when the window
 * actually gains focus, so the caret is where the typing will go.
 */
export function FocusPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const refocus = () => {
      const root = editor.getRootElement();
      if (root && !root.contains(document.activeElement)) {
        editor.focus();
      }
    };
    window.addEventListener("focus", refocus);
    return () => {
      window.removeEventListener("focus", refocus);
    };
  }, [editor]);

  return null;
}

/**
 * The formatting shortcuts, inside the editor rather than on the window.
 *
 * They used to live in the panel's one keyboard listener because the editor was
 * a textarea the panel could reach into. A rich editor owns its own keys, and
 * Lexical has its own bindings for ⌘B and ⌘I — so this registers at the highest
 * priority and answers `true`, which stops the built-in from firing as well and
 * toggling bold twice.
 */
export function ShortcutPlugin({ lang }: { lang: string }) {
  const [editor] = useLexicalComposerContext();
  const toolbar = useToolbarState(editor);

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          const command = formatCommandForKey(event);
          if (command === null) {
            return false;
          }
          event.preventDefault();
          runCommand(editor, command, toolbar, lang);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor, toolbar, lang],
  );

  return null;
}

/**
 * Pictures into the note: pasted from the clipboard, or dropped onto the panel
 * while this editor is the thing open (idea 17).
 *
 * Both paths end in the same place — the bytes are stored by Rust, and what
 * comes back is a name the note links to. Nothing is ever put in the note that
 * is not on disk first: an image node pointing at a file that does not exist is
 * a note with a hole in it.
 */
export function ImagePlugin() {
  const [editor] = useLexicalComposerContext();

  const insert = useCallback(
    (name: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertNodes([$createImageNode(`${IMAGE_PREFIX}${name}`)]);
          return;
        }
        $getRoot().append($createParagraphNode().append($createImageNode(`${IMAGE_PREFIX}${name}`)));
      });
    },
    [editor],
  );

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        // Lexical's paste command carries a keyboard event too, for the
        // clipboard-less paste some platforms send; only the real one has data.
        (event) => {
          if (!(event instanceof ClipboardEvent)) {
            return false;
          }
          const files = [...(event.clipboardData?.items ?? [])]
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          if (files.length === 0) {
            // Text, or something this does not handle: let the editor have it.
            return false;
          }
          event.preventDefault();
          for (const file of files) {
            void file
              .arrayBuffer()
              .then((bytes) => imagesSave(new Uint8Array(bytes)))
              .then(insert)
              .catch((error: unknown) => {
                console.error("images: could not store what was pasted", error);
              });
          }
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, insert],
  );

  useEffect(() => {
    // Rust announces a drop wherever it lands on the panel; while the editor is
    // open, the note being written is where it goes.
    const unlisten = onImagesDropped((names) => {
      for (const name of names) {
        insert(name);
      }
    });
    return () => {
      void unlisten.then((off) => {
        off();
      });
    };
  }, [insert]);

  return null;
}
