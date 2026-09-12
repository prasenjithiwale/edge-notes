import { useEffect, useMemo, useRef } from "react";
import { Pin, Plus, Search } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { Toast } from "../components/Toast";
import { cx } from "../lib/cx";
import { isExpandedPhase } from "../lib/dock";
import {
  dockToggle,
  NOTE_COLORS,
  onNewNoteRequested,
  onSettingsChanged,
} from "../lib/ipc";
import { facetColors, filterNotes } from "../lib/notes";
import { moveCardFocus } from "../notes/cardFocus";
import { ColorFilter } from "../notes/ColorFilter";
import { EmptyState } from "../notes/EmptyState";
import { NoteList } from "../notes/NoteList";
import { SearchField } from "../notes/SearchField";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { useSettingsStore } from "../store/settings";
import styles from "./Panel.module.css";

interface PanelProps {
  className: string;
}

/** True for a field where arrow keys and Cmd+F belong to the text, not the list. */
function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

export function Panel({ className }: PanelProps) {
  const panelRef = useRef<HTMLElement>(null);

  const keepOpen = useDockStore((state) => state.keepOpen);
  const setKeepOpen = useDockStore((state) => state.setKeepOpen);

  const notes = useNotesStore((state) => state.notes);
  const loaded = useNotesStore((state) => state.loaded);
  const editingId = useNotesStore((state) => state.editingId);
  const pendingUndo = useNotesStore((state) => state.pendingUndo);
  const searching = useNotesStore((state) => state.searching);
  const query = useNotesStore((state) => state.query);
  const colorFilter = useNotesStore((state) => state.colorFilter);
  const load = useNotesStore((state) => state.load);
  const createNote = useNotesStore((state) => state.createNote);
  const startEditing = useNotesStore((state) => state.startEditing);
  const undoRemove = useNotesStore((state) => state.undoRemove);
  const openSearch = useNotesStore((state) => state.openSearch);
  const setQuery = useNotesStore((state) => state.setQuery);
  const closeSearch = useNotesStore((state) => state.closeSearch);
  const setColorFilter = useNotesStore((state) => state.setColorFilter);

  const loadSettings = useSettingsStore((state) => state.load);
  const applySettings = useSettingsStore((state) => state.apply);

  useEffect(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);

  useEffect(() => {
    const unlisten = onSettingsChanged(applySettings);
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [applySettings]);

  // The tray and the global shortcut both arrive here (brief 6.11, 9.4). The
  // store is read through getState() so the subscription is set up once.
  useEffect(() => {
    const unlisten = onNewNoteRequested(() => {
      void useNotesStore.getState().createNote();
    });
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);

  // The filter row offers the colours of notes matching the *query*, not of the
  // colour-filtered result: filtering to one colour must not remove the dots
  // needed to switch to another (brief 6.7).
  const queryMatches = useMemo(() => filterNotes(notes, { query }), [notes, query]);
  const facets = useMemo(
    () => facetColors(queryMatches, NOTE_COLORS, colorFilter),
    [queryMatches, colorFilter],
  );
  const visible = useMemo(
    () => filterNotes(queryMatches, { color: colorFilter }),
    [queryMatches, colorFilter],
  );

  // Keyboard handling sits on the window, not on the panel element: closing the
  // editor or the search field unmounts the focused node and focus falls back to
  // the body, where a handler bound to the panel subtree would never see a key
  // again. Store state is read through getState() so the listener is registered
  // once and can never act on a stale snapshot.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The webview can keep key focus after the panel collapses, so every panel
      // shortcut is scoped to a panel that is actually on screen. Esc in
      // particular must not toggle a collapsed panel back open.
      if (!isExpandedPhase(useDockStore.getState().phase)) {
        return;
      }

      const notesStore = useNotesStore.getState();
      const accel = event.metaKey || event.ctrlKey;

      if (accel && event.key === "f") {
        event.preventDefault();
        notesStore.openSearch();
        return;
      }
      if (accel && event.key === "n") {
        event.preventDefault();
        void notesStore.createNote();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // Inside a text field the arrows belong to the caret.
        if (isTextField(event.target)) {
          return;
        }
        if (moveCardFocus(panelRef.current, event.key === "ArrowDown" ? 1 : -1)) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Escape") {
        // One ordered cascade (brief 6.11): the editor, then search, then the
        // panel. Deciding it in a single place beats three handlers racing to
        // swallow the same key.
        if (notesStore.editingId !== null) {
          void notesStore.stopEditing();
        } else if (notesStore.searching) {
          notesStore.closeSearch();
        } else {
          void dockToggle();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Closing the editor unmounts the textarea, so focus would otherwise land on
  // the body and the next arrow key would re-enter the list from the top. Put it
  // back on the card that was being edited instead.
  const lastEditedRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastEditedRef.current;
    lastEditedRef.current = editingId;
    if (editingId !== null || previous === null) {
      return;
    }
    const card = panelRef.current?.querySelector<HTMLElement>(
      `[data-card][data-id="${previous}"]`,
    );
    card?.focus();
  }, [editingId]);

  const isEmpty = loaded && notes.length === 0;

  return (
    <section
      ref={panelRef}
      className={cx(className, styles.panel)}
      data-slide="true"
      data-panel=""
    >
      <header className={styles.header}>
        {searching ? (
          <SearchField
            query={query}
            onQueryChange={setQuery}
            onAbandon={closeSearch}
          />
        ) : (
          <h1 className={styles.title}>Notes</h1>
        )}
        <div className={styles.actions}>
          {!searching && (
            <IconButton label="Search notes" onClick={openSearch}>
              <Search size={16} strokeWidth={1.75} />
            </IconButton>
          )}
          <IconButton
            label="Keep open"
            active={keepOpen}
            pressed={keepOpen}
            onClick={() => {
              setKeepOpen(!keepOpen);
            }}
          >
            <Pin size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="New note"
            outlined
            onClick={() => {
              void createNote();
            }}
          >
            <Plus size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      {facets.length > 0 && (
        <ColorFilter
          colors={facets}
          selected={colorFilter}
          onSelect={setColorFilter}
        />
      )}

      {/* Nothing until the first load resolves, so the panel never flashes an
          empty state on the way in. */}
      {!loaded ? null : isEmpty ? (
        <EmptyState
          kind="no-notes"
          onCreate={() => {
            void createNote();
          }}
        />
      ) : visible.length === 0 ? (
        query.trim() === "" ? (
          <EmptyState kind="no-colour" />
        ) : (
          <EmptyState kind="no-matches" query={query.trim()} />
        )
      ) : (
        <NoteList notes={visible} editingId={editingId} onOpen={startEditing} />
      )}

      {pendingUndo && (
        <Toast
          message="Note deleted"
          actionLabel="Undo"
          onAction={() => {
            void undoRemove();
          }}
        />
      )}
    </section>
  );
}
