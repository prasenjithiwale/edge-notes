import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Pin, Plus, Search, Settings as SettingsIcon } from "lucide-react";
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
  securityStatus,
  type SecurityStatus,
} from "../lib/ipc";
import { facetColors, filterNotes } from "../lib/notes";
import { openTaskCount, taskReminders } from "../lib/tasks";
import { isRunning } from "../lib/pomodoro";
import { useTasksStore } from "../store/tasks";
import { pomodoroReminder, usePomodoroStore } from "../store/pomodoro";
import { moveCardFocus } from "../notes/cardFocus";
import { ArchiveView } from "../notes/ArchiveView";
import { LockedView } from "../notes/LockedView";
import { QuickCapture } from "../notes/QuickCapture";
import { ColorFilter } from "../notes/ColorFilter";
import { EmptyState } from "../notes/EmptyState";
import { NoteEditor } from "../notes/NoteEditor";
import { NoteList } from "../notes/NoteList";
import { NoteReader } from "../notes/NoteReader";
import { TasksView } from "../notes/TasksView";
import { PomodoroView } from "../focus/PomodoroView";
import { TABS, ViewTabs } from "../notes/ViewTabs";
import { SearchField } from "../notes/SearchField";
import { SettingsView } from "../settings/SettingsView";
import { useArchiveStore } from "../store/archive";
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

/**
 * True for somewhere text is being written, where the arrows belong to the caret
 * and Space is a space. The note editor is a rich-text surface rather than a
 * field, so `isContentEditable` counts too.
 */
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function Panel({ className }: PanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  // Null until Rust answers. The panel draws its normal self meanwhile: a flash
  // of the notes list is better than a flash of a lock on every open.
  const [security, setSecurity] = useState<SecurityStatus | null>(null);

  const keepOpen = useDockStore((state) => state.keepOpen);
  const setKeepOpen = useDockStore((state) => state.setKeepOpen);
  const phase = useDockStore((state) => state.phase);
  const large = useDockStore((state) => state.large);
  const quick = useDockStore((state) => state.quick);
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
  const tasks = useTasksStore((state) => state.tasks);
  const loadTasks = useTasksStore((state) => state.load);
  const taskUndo = useTasksStore((state) => state.pendingUndo);
  const pomodoro = usePomodoroStore((store) => store.state);
  const focusTaskId = usePomodoroStore((store) => store.taskId);
  const hydratePomodoro = usePomodoroStore((store) => store.hydrate);
  const settlePomodoro = usePomodoroStore((store) => store.settle);
  const undoTaskRemove = useTasksStore((state) => state.undoRemove);
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

  const loadArchive = useArchiveStore((state) => state.load);
  const archived = useArchiveStore((state) => state.items.length);
  const loadSettings = useSettingsStore((state) => state.load);
  const applySettings = useSettingsStore((state) => state.apply);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoaded = useSettingsStore((state) => state.loaded);

  useEffect(() => {
    void load();
    void loadTasks();
    void loadSettings();
    void loadArchive();
    void securityStatus()
      .then(setSecurity)
      .catch((error: unknown) => {
        // The notes are already loaded or not; this only decides whether to say
        // why they are empty.
        console.error("panel: could not read the security status", error);
      });
  }, [load, loadTasks, loadSettings, loadArchive]);

  useEffect(
    () => subscription(onSettingsChanged(applySettings), "settings:changed"),
    [applySettings],
  );

  // The Focus tab's lengths, its auto-start switch and the day's tally live in
  // the settings table, so the timer takes them from here rather than reading
  // storage itself. `hydrate` is idempotent: the tally is read once, the lengths
  // follow every later change.
  useEffect(() => {
    if (settingsLoaded) {
      hydratePomodoro(settings);
    }
  }, [settings, settingsLoaded, hydratePomodoro]);

  // A phase that ran out while the panel was collapsed is over the moment the
  // panel comes back, whichever tab is in front: the Focus tab's own clock is
  // only subscribed while that tab is showing.
  useEffect(() => {
    if (isExpandedPhase(phase)) {
      settlePomodoro(Date.now());
    }
  }, [phase, settlePomodoro]);

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

  // Brief 6.3: an undo toast in use holds the panel open. Without this, deleting
  // a note and moving the cursor away collapsed the panel with the toast still
  // counting down, and the only way to undo went with it.
  useEffect(() => {
    setLock("undo", pendingUndo !== null || taskUndo !== null);
  }, [pendingUndo, taskUndo, setLock]);

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
  const archiveOpenRef = useRef(false);
  useEffect(() => {
    settingsOpenRef.current = showSettings;
    archiveOpenRef.current = showArchive;
  }, [showSettings, showArchive]);

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
      const tasksStore = useTasksStore.getState();
      const accel = event.metaKey || event.ctrlKey;

      if (accel && event.key === "f") {
        // Search works on whichever list is in front; the Focus tab is not one.
        if (notesStore.view === "focus") {
          return;
        }
        event.preventDefault();
        notesStore.openSearch();
        return;
      }
      if (accel && event.key === "n") {
        event.preventDefault();
        // "New" means the thing this tab is a list of.
        if (notesStore.view === "todo") {
          panelRef.current?.querySelector<HTMLElement>("[data-task-add]")?.focus();
        } else {
          void notesStore.createNote();
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // Inside a text field the arrows belong to the caret.
        if (isTextField(event.target) || notesStore.view === "focus") {
          return;
        }
        // Each list tab has its own kind of row; the movement is the same.
        const rows = notesStore.view === "todo" ? "[data-task-row]" : "[data-card]";
        if (
          moveCardFocus(panelRef.current, event.key === "ArrowDown" ? 1 : -1, rows)
        ) {
          event.preventDefault();
        }
        return;
      }
      // Space ticks the task the keyboard is on. Enter is the button's own job
      // (it opens the sheet), so the box needs a key of its own, and Space is
      // the one every list of things to finish uses.
      if (
        event.key === " " &&
        notesStore.view === "todo" &&
        !isTextField(event.target) &&
        event.target instanceof HTMLElement
      ) {
        const row = event.target.closest<HTMLElement>("[data-task-row]");
        const id = row?.dataset.id;
        if (id !== undefined) {
          event.preventDefault();
          void tasksStore.tick(id);
          return;
        }
      }
      // The Focus tab is one control with two more beside it, so it gets the
      // keys a media player would: space to start or stop, R and S for the rest.
      if (notesStore.view === "focus" && !accel && !isTextField(event.target)) {
        const pomodoroStore = usePomodoroStore.getState();
        if (event.key === " ") {
          event.preventDefault();
          if (isRunning(pomodoroStore.state)) {
            pomodoroStore.pauseTimer();
          } else {
            pomodoroStore.startTimer();
          }
          return;
        }
        if (event.key === "r" || event.key === "R") {
          event.preventDefault();
          pomodoroStore.resetTimer();
          return;
        }
        if (event.key === "s" || event.key === "S") {
          event.preventDefault();
          pomodoroStore.skip();
          return;
        }
      }
      if (event.key === "Escape") {
        // One ordered cascade (brief 6.11): the editor, then an expanded note,
        // then search, then the Tasks tab's picker and draft, then the panel.
        // Deciding it in a single place beats several handlers racing to
        // swallow the same key.
        if (settingsOpenRef.current) {
          setShowSettings(false);
        } else if (archiveOpenRef.current) {
          setShowArchive(false);
        } else if (notesStore.editingId !== null) {
          void notesStore.stopEditing();
        } else if (notesStore.expandedId !== null) {
          notesStore.shrink();
        } else if (notesStore.searching) {
          notesStore.closeSearch();
        } else if (notesStore.view === "todo" && tasksStore.detailsId !== null) {
          // The open sheet is the front-most thing on the tab, so it goes first.
          tasksStore.openDetails(null);
        } else if (notesStore.view === "todo" && tasksStore.draft !== "") {
          // A half-typed task clears before the panel goes.
          tasksStore.setDraft("");
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
    // Switching to Tasks also closes the editor; the card is off screen then.
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
      const focusTask = tasks.find((task) => task.id === focusTaskId)?.title ?? null;
      void remindersSet([...taskReminders(tasks), ...pomodoroReminder(pomodoro, focusTask)]);
    }, REMINDERS_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [tasks, pomodoro, focusTaskId, loaded]);

  const isEmpty = loaded && notes.length === 0;
  const openTasks = useMemo(() => openTaskCount(tasks), [tasks]);

  // Only once Rust has actually grown the window: drawing the large layout into
  // the normal panel would squeeze a note meant for reading into 320 px.
  const expandedNote =
    large && expandedId !== null
      ? notes.find((candidate) => candidate.id === expandedId)
      : undefined;

  const tabIndex = Math.max(
    0,
    TABS.findIndex((tab) => tab.view === view),
  );
  const paneWidth = { width: `${String(100 / TABS.length)}%` };

  const openExpanded = (id: string) => {
    const target = notes.find((candidate) => candidate.id === id);
    // A pinned note opens to read, as its card does; any other note to edit.
    void expand(id, { edit: target ? !target.pinned : true });
  };

  if (quick) {
    // Summoned by its own shortcut, and it is the whole panel while it is up:
    // there is no list to show beside a field that exists to be gone in a
    // second, and the window Rust sized has no room for one.
    return (
      <section
        ref={panelRef}
        className={cx(className, styles.panel)}
        data-slide="true"
        data-panel=""
      >
        <QuickCapture />
      </section>
    );
  }

  if (security?.protection === "locked") {
    // The whole panel, header and toolbar included. Nothing above the locked
    // view would do what it says: the database behind every one of those
    // controls is an empty in-memory stand-in, so a New note button would take
    // a note and lose it, and Settings would offer to change defaults that
    // belong to nothing.
    return (
      <section
        ref={panelRef}
        className={cx(className, styles.panel)}
        data-slide="true"
        data-panel=""
      >
        <LockedView
          status={security}
          onUnlocked={(status) => {
            setSecurity(status);
            void load();
            void loadTasks();
            void loadSettings();
            void loadArchive();
          }}
        />
      </section>
    );
  }

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
            what={view === "todo" ? "tasks" : "notes"}
            onQueryChange={setQuery}
            onAbandon={closeSearch}
          />
        ) : (
          <ViewTabs
            view={view}
            openTasks={openTasks}
            focusRunning={isRunning(pomodoro)}
            onChange={(next) => {
              setShowSettings(false);
              void setView(next);
            }}
          />
        )}
        {/* What the header keeps is what acts on what is in front of you.
            Settings and Keep open are about the panel itself and live in the
            toolbar at the foot of it. */}
        <div className={styles.actions}>
          {!searching && !expandedNote && view !== "focus" && (
            <IconButton
              label={view === "todo" ? "Search tasks" : "Search notes"}
              shortcut="⌘F"
              onClick={openSearch}
            >
              <Search size={16} strokeWidth={1.75} />
            </IconButton>
          )}
          {view !== "focus" && (
            <IconButton
              label={view === "todo" ? "New task" : "New note"}
              shortcut="⌘N"
              outlined
              onClick={() => {
                if (view === "todo") {
                  panelRef.current?.querySelector<HTMLElement>("[data-task-add]")?.focus();
                } else {
                  void createNote();
                }
              }}
            >
              <Plus size={16} strokeWidth={1.75} />
            </IconButton>
          )}
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
      ) : showArchive ? (
        <ArchiveView
          onClose={() => {
            setShowArchive(false);
          }}
        />
      ) : (
        // Notes and Tasks sit side by side on a track that slides between them,
        // in tab order. Both stay mounted so there is something to slide; the
        // one off screen is inert and hidden from assistive technology, and
        // becomes invisible once the slide has finished.
        <div className={styles.views}>
          {/* The track is as wide as the tabs and shifts by one pane. Both
              numbers come from `TABS`, so adding a tab is adding a tab. */}
          <div
            className={styles.track}
            style={{
              width: `${String(TABS.length * 100)}%`,
              transform: `translateX(-${String((tabIndex * 100) / TABS.length)}%)`,
            }}
          >
            <div
              className={styles.pane}
              style={paneWidth}
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
              style={paneWidth}
              aria-hidden={view !== "todo"}
              inert={view !== "todo"}
            >
              <TasksView active={view === "todo"} query={query} />
            </div>
            <div
              className={styles.pane}
              style={paneWidth}
              aria-hidden={view !== "focus"}
              inert={view !== "focus"}
            >
              <PomodoroView active={view === "focus"} />
            </div>
          </div>
        </div>
      )}

      {/* The panel's own controls, at the foot of it and the same on every tab:
          what they change is the panel, not what is in it. */}
      <div className={styles.toolbar}>
        {/* Settings and the archive are one group at the left: they are both the
            panel showing you something about itself, and `space-between` on
            three buttons left the archive stranded in the middle of the bar
            rather than beside the gear it belongs to. */}
        <div className={styles.toolbarGroup}>
        <IconButton
          label={showSettings ? "Back" : "Settings"}
          active={showSettings}
          pressed={showSettings}
          onClick={() => {
            setShowArchive(false);
            setShowSettings((open) => !open);
          }}
        >
          <SettingsIcon size={16} strokeWidth={1.75} />
        </IconButton>
        {/* Beside Settings, and dead while the archive is empty: a button that
            opens a screen saying "nothing here" is a button that wasted a press.
            The count is in its name, so what it would show is known before it is
            pressed — and by a screen reader, not only by eye. */}
        <IconButton
          label={
            showArchive
              ? "Back"
              : archived === 0
                ? "Archive, empty"
                : `Archive, ${String(archived)} deleted`
          }
          active={showArchive}
          pressed={showArchive}
          disabled={archived === 0 && !showArchive}
          onClick={() => {
            setShowSettings(false);
            setShowArchive((open) => !open);
          }}
        >
          <Archive size={16} strokeWidth={1.75} />
        </IconButton>
        </div>
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
      </div>

      {/* One toast at a time: a delete in one tab is the only thing being
          undone, and the tabs cannot both be in front. */}
      {pendingUndo ? (
        <Toast
          message="Note deleted"
          actionLabel="Undo"
          onAction={() => {
            void undoRemove();
          }}
        />
      ) : (
        taskUndo && (
          <Toast
            message="Task deleted"
            actionLabel="Undo"
            onAction={() => {
              void undoTaskRemove();
            }}
          />
        )
      )}
    </section>
  );
}
