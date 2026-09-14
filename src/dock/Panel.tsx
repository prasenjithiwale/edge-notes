import { useEffect, useMemo, useRef, useState } from "react";
import { Pin, Plus, Search, Settings as SettingsIcon } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { IconButton } from "../components/IconButton";
import { Toast } from "../components/Toast";
import { cx } from "../lib/cx";
import { isExpandedPhase } from "../lib/dock";
import {
  appQuit,
  dockSetLarge,
  remindersSet,
  dockToggle,
  NOTE_COLORS,
  onNewNoteRequested,
  onQuitRequested,
  onSettingsChanged,
} from "../lib/ipc";
import { facetColors, filterNotes } from "../lib/notes";
import { openTaskCount, taskReminders } from "../lib/tasks";
import { moveCardFocus } from "../notes/cardFocus";
import { ColorFilter } from "../notes/ColorFilter";
import { EmptyState } from "../notes/EmptyState";
import {
  applyFormat,
  applyListContinuation,
  formatCommandForKey,
  noteEditorField,
} from "../notes/formatting";
import { NoteEditor } from "../notes/NoteEditor";
import { NoteList } from "../notes/NoteList";
import { NoteReader } from "../notes/NoteReader";
import { TodoView } from "../notes/TodoView";
import { ViewTabs } from "../notes/ViewTabs";
import { SearchField } from "../notes/SearchField";
import { SettingsView } from "../settings/SettingsView";
import { useDockStore } from "../store/dock";
import { useNotesStore } from "../store/notes";
import { useSettingsStore } from "../store/settings";
import styles from "./Panel.module.css";

/** How long notes must be still before the reminder list is re-sent. */
const REMINDERS_DEBOUNCE_MS = 1_000;

interface PanelProps {
  className: string;
}

/**
 * An effect cleanup for a `listen()` that may still be pending, or may have
 * failed. The rejection is logged here rather than left unhandled: a panel that
 * misses an event is degraded, but an unhandled rejection is noise that hides
 * real failures (and fails the test run).
 */
function subscription(pending: Promise<UnlistenFn>, event: string): () => void {
  pending.catch((error: unknown) => {
    console.error(`panel: failed to listen for ${event}`, error);
  });
  return () => {
    void pending.then(
      (stop) => {
        stop();
      },
      () => undefined,
    );
  };
}

/** True for a field where arrow keys and Cmd+F belong to the text, not the list. */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
  );
}

export function Panel({ className }: PanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  const keepOpen = useDockStore((state) => state.keepOpen);
  const setKeepOpen = useDockStore((state) => state.setKeepOpen);
  const phase = useDockStore((state) => state.phase);
  const large = useDockStore((state) => state.large);
  const setLock = useDockStore((state) => state.setLock);

  const notes = useNotesStore((state) => state.notes);
  const loaded = useNotesStore((state) => state.loaded);
  const editingId = useNotesStore((state) => state.editingId);
  const expandedId = useNotesStore((state) => state.expandedId);
  const view = useNotesStore((state) => state.view);
  const setView = useNotesStore((state) => state.setView);
  const expand = useNotesStore((state) => state.expand);
  const shrink = useNotesStore((state) => state.shrink);
  const toggleTask = useNotesStore((state) => state.toggleTask);
  const pendingUndo = useNotesStore((state) => state.pendingUndo);
  const searching = useNotesStore((state) => state.searching);
  const query = useNotesStore((state) => state.query);
  const colorFilter = useNotesStore((state) => state.colorFilter);
  const load = useNotesStore((state) => state.load);
  const createNote = useNotesStore((state) => state.createNote);
  const startEditing = useNotesStore((state) => state.startEditing);
  const setPinned = useNotesStore((state) => state.setPinned);
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

  useEffect(
    () => subscription(onSettingsChanged(applySettings), "settings:changed"),
    [applySettings],
  );

  // The tray and the global shortcut both arrive here (brief 6.11, 9.4). The
  // store is read through getState() so the subscription is set up once.
  useEffect(
    () =>
      subscription(
        onNewNoteRequested(() => {
          void useNotesStore.getState().createNote();
        }),
        "ui:new-note",
      ),
    [],
  );

  // Brief 11: no data loss, flush on quit. Autosave is debounced, so without
  // this the last 400 ms of typing died with the process.
  useEffect(
    () =>
      subscription(
        onQuitRequested(() => {
          void useNotesStore
            .getState()
            .flushAll()
            .finally(() => {
              void appQuit();
            });
        }),
        "app:quit-requested",
      ),
    [],
  );

  // An expanded note needs the large panel, and Rust owns the window size. The
  // request is derived from state rather than sent from the click handlers, so
  // every way of ending an expansion — shrink, delete, search, a new note —
  // returns the panel to normal without each remembering to.
  const expanded = expandedId !== null;
  useEffect(() => {
    void dockSetLarge(expanded);
    // Reading a long note with the cursor resting elsewhere must not slide the
    // panel away mid-sentence (brief 6.3's interaction lock, held by the view).
    setLock("expanded", expanded);
  }, [expanded, setLock]);

  // Rust ends the large panel when the dock collapses; the frontend follows, so
  // the next open shows the list rather than a note in a panel that is not large.
  useEffect(() => {
    if (phase === "collapsed") {
      shrink();
    }
  }, [phase, shrink]);

  // The filter row offers the colours of notes matching the *query*, not of the
  // colour-filtered result: filtering to one colour must not remove the dots
  // needed to switch to another (brief 6.7).
  const queryMatches = useMemo(
    () => filterNotes(notes, { query }),
    [notes, query],
  );
  const facets = useMemo(
    () => facetColors(queryMatches, NOTE_COLORS, colorFilter),
    [queryMatches, colorFilter],
  );
  const visible = useMemo(
    () => filterNotes(queryMatches, { color: colorFilter }),
    [queryMatches, colorFilter],
  );

  // The keydown listener is registered once, so it reads the current value
  // through a ref rather than closing over a stale one. Written in an effect,
  // because a ref must not be touched during render.
  const settingsOpenRef = useRef(false);
  useEffect(() => {
    settingsOpenRef.current = showSettings;
  }, [showSettings]);

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

      // Formatting belongs to the note editor's textarea, and only to it.
      const field = noteEditorField(event.target);
      if (field) {
        const command = formatCommandForKey(event);
        if (command !== null) {
          event.preventDefault();
          applyFormat(field, command);
          return;
        }
        // Enter continues a list. Not while an input method is composing — that
        // Enter commits the composition (WebKit reports it as key code 229) — and
        // not with a modifier, so Shift+Enter still gives a plain line break.
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.altKey &&
          !accel &&
          !event.isComposing &&
          // Safari fires the committing keydown after compositionend, with
          // isComposing already false; 229 is the only thing that marks it.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          event.keyCode !== 229 &&
          applyListContinuation(field)
        ) {
          event.preventDefault();
          return;
        }
      }

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
        // Inside a text field the arrows belong to the caret, and the cards are
        // only reachable while the Notes tab is showing.
        if (isTextField(event.target) || notesStore.view !== "notes") {
          return;
        }
        if (
          moveCardFocus(panelRef.current, event.key === "ArrowDown" ? 1 : -1)
        ) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Escape") {
        // One ordered cascade (brief 6.11): the editor, then an expanded note,
        // then search, then the panel. Deciding it in a single place beats
        // several handlers racing to swallow the same key.
        if (settingsOpenRef.current) {
          setShowSettings(false);
        } else if (notesStore.editingId !== null) {
          void notesStore.stopEditing();
        } else if (notesStore.expandedId !== null) {
          notesStore.shrink();
        } else if (notesStore.searching) {
          notesStore.closeSearch();
        } else if (notesStore.view === "todo" && notesStore.taskDraft !== "") {
          // A half-typed task clears before the panel goes.
          notesStore.setTaskDraft("");
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
    // Switching to To-Do also closes the editor; the card is off screen then.
    if (useNotesStore.getState().view !== "notes") {
      return;
    }
    const card = panelRef.current?.querySelector<HTMLElement>(
      `[data-card][data-id="${previous}"]`,
    );
    card?.focus();
  }, [editingId]);

  // Reminders follow the notes: every change sends Rust the whole list, after a
  // pause so a burst of typing is one update. Rust keeps what it has already
  // shown, so a re-sent list never repeats a notification.
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const timer = setTimeout(() => {
      void remindersSet(taskReminders(notes));
    }, REMINDERS_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notes, loaded]);

  const isEmpty = loaded && notes.length === 0;
  const openTasks = useMemo(() => openTaskCount(notes), [notes]);

  // Only once Rust has actually grown the window: drawing the large layout into
  // the normal panel would squeeze a note meant for reading into 320 px.
  const expandedNote =
    large && expandedId !== null
      ? notes.find((candidate) => candidate.id === expandedId)
      : undefined;

  const openExpanded = (id: string) => {
    const target = notes.find((candidate) => candidate.id === id);
    // A pinned note opens to read, as its card does; any other note to edit.
    void expand(id, { edit: target ? !target.pinned : true });
  };

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
          <ViewTabs
            view={view}
            openTasks={openTasks}
            onChange={(next) => {
              setShowSettings(false);
              void setView(next);
            }}
          />
        )}
        <div className={styles.actions}>
          {!expandedNote && (
          <IconButton
            label={showSettings ? "Back to notes" : "Settings"}
            active={showSettings}
            pressed={showSettings}
            onClick={() => {
              setShowSettings((open) => !open);
            }}
          >
            <SettingsIcon size={16} strokeWidth={1.75} />
          </IconButton>
          )}
          {!searching && !expandedNote && view === "notes" && (
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

      {expandedNote ? (
        <div className={styles.large}>
          {editingId === expandedNote.id ? (
            <NoteEditor key={expandedNote.id} note={expandedNote} large />
          ) : (
            <NoteReader note={expandedNote} />
          )}
        </div>
      ) : showSettings ? (
        <SettingsView
          onClose={() => {
            setShowSettings(false);
          }}
        />
      ) : (
        // Notes and To-Do sit side by side on a track that slides between them,
        // in tab order. Both stay mounted so there is something to slide; the
        // one off screen is inert and hidden from assistive technology, and
        // becomes invisible once the slide has finished.
        <div className={styles.views}>
          <div className={cx(styles.track, view === "todo" && styles.trackTodo)}>
            <div
              className={styles.pane}
              aria-hidden={view !== "notes"}
              inert={view !== "notes"}
            >
              {facets.length > 0 && (
                <ColorFilter
                  colors={facets}
                  selected={colorFilter}
                  onSelect={setColorFilter}
                />
              )}

              {/* Nothing until the first load resolves, so the panel never flashes
              an empty state on the way in. */}
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
                <NoteList
                  notes={visible}
                  editingId={editingId}
                  onOpen={startEditing}
                  onUnpin={(id) => {
                    void setPinned(id, false);
                  }}
                  onExpand={openExpanded}
                  onToggleTask={toggleTask}
                />
              )}
            </div>
            <div
              className={styles.pane}
              aria-hidden={view !== "todo"}
              inert={view !== "todo"}
            >
              <TodoView
                active={view === "todo"}
                onOpenNote={(id) => {
                  void setView("notes").then(() => {
                    startEditing(id);
                  });
                }}
              />
            </div>
          </div>
        </div>
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
