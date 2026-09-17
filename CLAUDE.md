# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rules

- The full spec is `docs/build-brief.md`. Read it before any task.
- Current status, decisions, and platform findings are in `docs/progress.md`. Read it before any task and update it at the end of every milestone.
- Work on one milestone at a time. Stop when it's done. At the end of each milestone, summarize what changed and give a manual test checklist before continuing.
- Don't add dependencies outside section 4 of the brief without asking. Two have been approved since: `lexical` and `@lexical/react` (0.50.0, exact), for the rich-text note editor.
- Don't change files in `src-tauri/src/dock/` or `src-tauri/src/platform/` unless the task requires it. If you must, explain why first and run the dock tests afterward.
- Before saying a task is done: `cargo fmt`, `cargo clippy` (no warnings), `cargo test`, and the frontend lint and tests must all pass.
- Verify Tauri APIs against the current Tauri 2 docs (https://v2.tauri.app) before using them. Code in the brief is a sketch, not copy-paste-ready.
- Treat the UI rules in section 7 of the brief as hard requirements, not suggestions.

## Commands

**Run `nvm use` first in any fresh shell.** `.nvmrc` pins Node 24; the Node 25 on
`PATH` from Homebrew is outside Vitest 5's supported engine range.

```bash
nvm use && npm install

npm run tauri dev            # run the app (Vite + Rust, hot reload)
npm run tauri build          # release bundle (.app, .dmg)
npm run tauri build -- --bundles app   # .app only, much faster

npm run lint                 # ESLint, zero warnings allowed
npm test                     # Vitest (node by default; component tests opt into
                             # jsdom with a `// @vitest-environment jsdom` docblock)
npx tsc --noEmit             # type check (not part of lint)
npx vitest run src/lib/dock.test.ts    # one frontend test file
npx vitest run -t "flips the chevron"  # one test by name

cd src-tauri && cargo fmt
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test
cd src-tauri && cargo test dock::controller   # one module
cd src-tauri && cargo test hover_intent       # one test
```

Linux blank-window workaround on some NVIDIA/WebKitGTK setups: `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

## Architecture

A desktop notes widget: a small tab docked to the left or right screen edge, floating above other apps. Hover slides out a 320 px panel of color-coded notes; leaving slides it back.

**Rust owns everything stateful.** SQLite, window geometry, and the dock state machine all live in Rust; the webview gets no window, filesystem, shell, or SQL permissions — only event listening plus the typed commands in section 9.3 of the brief. Components never call `invoke` directly; every command and event is wrapped in `src/lib/ipc.ts`.

**The window is always exactly the size of what's visible.** Collapsed it is just the tab (28×88); open it is the panel plus tab plus a 12 px transparent margin on the three sides away from the screen edge (room for the panel's shadow). There is no full-screen click-through overlay — a window that ignores the mouse can't detect hover either. Hit-testing uses the panel rect, not the window rect.

**Hover detection lives in Rust, not the DOM.** On macOS an inactive window receives no mouse enter/exit/move events (tauri-apps/tauri#11386), and this widget is inactive almost all the time. So a `DockController` polls `AppHandle::cursor_position()` from a single thread and hit-tests against the tab and panel rects — 33 ms while open or when the cursor is within 150 px of the docked edge, 150 ms otherwise. Never call `cursor_position()` or `available_monitors()` in tight or concurrent loops (crash reports: tauri-apps/tauri#15170). On Linux, frontend `pointerleave` and window blur feed in as secondary signals because the global cursor position can go stale under XWayland.

**A click on the tab is a drag that never moved.** The tab sends `dock_begin_tab_drag`/`dock_end_tab_drag` on pointer down/up, and the controller calls a press that never passed `DRAG_THRESHOLD_LOGICAL` a click — which opens or closes the panel when `dock.openOn` is `"click"`, and does nothing in hover mode. Don't add a separate frontend click command; it would race the drag. `dock.openOn` travels inside `Timings` so it applies live through `set_timings`.

**The controller is pure and the poller is the only thing that touches Tauri.** `dock/controller.rs` takes `Input` values plus a clock and returns `Action` values; `dock/poller.rs` applies them. `dock/geometry.rs` is pure math in physical pixels. This split is what makes docking unit-testable with a fake clock — keep it. Rust works in physical px, CSS in logical px; convert once at the boundary using the monitor's scale factor.

**There is no atomic bounds API in Tauri 2.11**, verified against the crate source. A right dock must keep `x + width` pinned to the screen edge, so `poller::apply_rect` issues `set_position` and `set_size` back to back inside one `run_on_main_thread` closure, and `geometry::apply_order` picks the order (move first when growing, resize first when shrinking). If a visible jump ever appears on macOS, the reserve fix is `NSPanel::setFrame_display_` through the panel handle.

**Animation is a frontend/Rust handshake, and the order prevents flicker.** Opening: Rust resizes the window first, then emits `dock:state` with `phase: "opening"` — until that event the frontend keeps the panel translated fully past the docked edge, so the resize reveals nothing. The frontend slides in, then calls `dock_animation_done("opening")`. Closing runs the reverse, and Rust shrinks the window anyway if no acknowledgment arrives within 300 ms. Cursor re-entry during `closing` reverses to `opening` without resizing.

**Opening never takes focus.** Focus happens only on click or shortcut. After collapse the previously active app keeps focus.

**An expanded note grows the dock panel; it does not open a window.** `DockGeometry::large` swaps in a panel of at most 760 logical px (or 60% of the work area) by 90% of the work-area height, and everything else — the docked edge, the tab, hit testing — follows from `panel_rect`. `dock:state` carries `panelWidth` and `large`, and `DockShell` paints `--panel-width` from that, not from the `panel.width` setting. `Panel` derives `dock_set_large` from whether `expandedId` is set, and draws the large layout only once Rust confirms `large`. `finish_close` clears the flag; `set_geometry` keeps it. After shrinking, `SHRINK_GRACE` holds the close, because the shrink button sits outside the normal panel.

**The frontend never changes layout between phases.** The tab and panel are one group anchored to the docked edge, with the closed state at `translateX(±panel-width)`. Because the collapsed and expanded windows share that edge, the same CSS puts the tab on identical screen pixels at both window sizes — which is what makes the resize invisible. Only the transform changes; don't replace this with per-phase layouts.

**`app_ready` must never depend on a frame.** The window is created hidden and Rust shows it only when the frontend calls `app_ready`, but WebKit suspends `requestAnimationFrame` in a window that has never been ordered in — so waiting for a paint before calling it kept the window hidden because it was hidden, silently, for three milestones. `DockShell` races the double-frame paint wait against a 120 ms fallback, and a failing `listen()` is caught rather than allowed to skip the call. Nothing on the path to `app_ready` may be able to not happen. Covered by `src/dock/DockShell.test.tsx`.

**Search is the panel's, not the notes'.** `Cmd+F` and the header's magnifier open the one search field over whichever list is in front, and `SearchField` is told `what` it is searching so it can say so. `openSearch` no longer forces the Notes tab; it only refuses the Focus tab, which is not a list. `TasksView` takes the query as a prop and filters with `filterTasks` (title and notes, plain substring, as the notes' search is). Changing tabs ends the search — a search is about the list you are looking at.

**The Tasks tab's rows are list rows and its sections fold.** A row has its own rounded background, a circular box with an animated tick, priority in front of the title rather than at the far edge, and a disclosure chevron that is always drawn (nothing essential is hover-only). `collapsed` in the tasks store keeps which sections are folded — for the session, because which part of a list you are looking at is where you are, not a preference — and Done starts folded. Arrow keys move between `[data-task-row]` through the same `moveCardFocus` the cards use, Space ticks the row the keyboard is on, and Enter opens the sheet. Opening a sheet scrolls it into view.

**Quick entry is shown as it is typed.** `parseTaskText` takes the current time and reads `@today`, `@tomorrow`, a weekday name or `@2026-09-20`, a time as `14:00`/`2pm`/`2:30 pm`, and `!!!`/`!!` beside `!high`/`!medium`/`!low`. `QuickPreview` in `TasksView` draws what it found as chips under the field: the tokens had always worked and nobody knew, and a feature you have to read the changelog to find is not a feature. A word after `@` that names no date stays in the title rather than being guessed at.

**The panel's own controls live at its foot, not in the header.** `Panel`'s `.toolbar` holds Settings and Keep open, the same on every tab; the header keeps only what acts on what is in front of you (search, new note) and the tabs. They were in the header until a third tab left no room, and they never belonged there: what they change is the panel, not its contents. The undo toast sits above the toolbar, through `--toolbar-height`.

**Adding a tab is adding an entry to `TABS`.** `ViewTabs` exports it, and `Panel` sizes the sliding track and each pane from its length as inline styles — CSS cannot divide by a custom property everywhere this has to run, and `repeat()` will not take one at all. `PanelView` is `"notes" | "todo" | "focus"`; `"todo"` is the Tasks tab, named before it was renamed.

**The Focus tab is a pomodoro, and its clock is a moment, not a countdown.** `lib/pomodoro.ts` is pure and keeps `endsAt`; `remaining` is `endsAt - now`. Nothing decrements a counter, because a widget spends its life in a collapsed panel behind another app where timers are throttled or stopped, and a counter would lose minutes without knowing. The end is *noticed* — `settle(now)` advances a phase whose time has passed, whenever anything next asks — and `PomodoroView` subscribes to a one-second clock only while the tab is up and the timer is running, while `Panel` settles once whenever the dock opens. A session that ends out of sight still says so: `pomodoroReminder` puts one reminder into the same list the tasks use, with the end time in its id, so pausing withdraws it and re-arming is a new id.

**The phase lengths live inside the timer's state, not in a module constant.** They are settings from 0.1.0 (`focus.focusMinutes`, `focus.breakMinutes`, `focus.longBreakMinutes`, `focus.longBreakEvery`, `focus.autoStart`), so `Pomodoro` carries a `Durations` and every function that needs one already has the state. `withDurations` gives a *stopped* phase the new length whole and leaves a *running* one ending exactly where it was: moving the finish line under someone mid-session is the one thing a timer must not do. The day's tally, the streak and the task a session is for are also stored (`focus.day`, `focus.today`, `focus.streak`, `focus.taskId`) — state rather than preferences, kept in the settings table because that is the app's key/value store and a counter does not deserve a table. `Panel` calls `hydrate(settings)`, which reads the lengths every time and the tally only once; the store writes the tally back through `useSettingsStore.patch`.

**The Focus tab and the Tasks tab meet in exactly one place.** A session can name the task it is for: the Focus tab picks from the open tasks, `TaskDetails` has "Focus on this", and the end-of-session notification says which task. A pomodoro with a name on it is a session; one without is a kitchen timer. Nothing else crosses — completing a session does not touch the task.

**Keyboard handling is one window-level listener, and the interaction lock is counted.** `Panel` binds a single `keydown` listener on `window` — not on the panel element, because closing the editor or the search field unmounts the focused node and a subtree handler then never sees another key. Esc resolves as one ordered cascade there (settings, editor, expanded note, search, then panel); components handle no keys themselves. Every panel shortcut is gated on `isExpandedPhase`, since the webview can hold key focus after a collapse and Esc must never toggle a collapsed panel open. The editor and the search field can both hold the panel open, so `dock.setLock(owner, held)` keeps a set of owners and calls `dock_set_interaction_lock` only when the aggregate flips; Rust still sees one boolean. The search field locks on focus, not while mounted.

**Code blocks are fences, and the highlighter is ours.** ```` ```python ```` opens a block and ```` ``` ```` closes it, so a note with code in it is still Markdown on export and still plain text in the database. `lib/markdown.ts` has a block pass (`parseBlocks`) that collapses a fenced run into one `code` block while every line keeps its index in the content, so ticking a checkbox below one still finds its own row. `lib/code.ts` is a lexer, not a parser: a table of languages (comment markers, quote characters, keyword lists, and flags for `property`, `markup`, `ignoreCase` and triple quotes) driving one loop. It knows nothing about scope or grammar and never fails — anything unrecognised stays plain, which is also how it degrades on a language it does not have. A highlighting library would have been a hundred kilobytes to be right about constructs a ten-line snippet in a 320 px panel never shows; this is 4.6 kB gzipped for sixteen languages.

**Syntax colour is the second agreed exception to brief 7.1**, after the priority flags. A fenced block gets its own neutral surface (`--code-bg`) rather than the note's colour, so there are two backgrounds to check instead of sixteen, and the note palette is still the only colour *in the note*. Five roles — comment, string, number, keyword, property — plus plain; `contrast.test.ts` holds each above AA on that surface in both themes and checks their hues are separable. Inline `` `code` `` keeps the note's own text colour over `--code-inline-bg`, which is contrast-checked against all sixteen note colours.

**The editor is rich text; the storage is still Markdown.** From 0.2.0 the note editor is Lexical (`src/notes/editor/`), because typing `**` is a thing a non-technical person should never have to know. What is stored is unchanged: `editor/markdown.ts` converts both ways, reading through `lib/markdown.ts`'s parser — the same one the cards use, so the editor and the card can never disagree — and writing our dialect exactly. **`@lexical/markdown`'s own transformers are deliberately not used for storage**: it writes `*italic*` where we write `_italic_` and `*` bullets where we write `-`, so round-tripping through it would silently rewrite every note on first open. `editor/markdown.test.ts` round-trips sixteen shapes of note and asserts the bytes are identical; that test is the contract. The serialiser has to *fold shared marks outwards* — the editor holds formatting flat, so three adjacent bold runs must become one `**…**`, not three.

**Markdown still works if you type it.** `editor/shortcuts.ts` builds a transformer list out of the library's pieces rather than taking `TRANSFORMERS` whole: its headings, quotes and code block are nodes this dialect cannot write, and a node that cannot be written back is lost on the next save. `EDITOR_NODES` in `editor/config.ts` is exactly what the dialect can store, and a test says so.

**A code block is a node with a textarea in it.** `editor/CodeNode.tsx` is a `DecoratorNode`: a language dropdown, a copy button, a remove button, and a real `<textarea>` with the highlighted text painted in a `<pre>` directly behind it. Every metric that could move a glyph is set once in `.surface` and shared by both layers; neither wraps, and scroll is copied from the field to the paint. Rich-text rules are all wrong inside code (a Return that starts a paragraph, smart quotes, autocorrect), and the block sits inside the editor's root, so **the whole editing conversation stops at the block's wrapper** — keydown, beforeinput, input, paste, cut, copy and composition — with Escape the one exception, because the panel's cascade owns it.

**Formatting commands are Lexical commands.** `editor/toolbar.ts` holds `useToolbarState` (what the caret is inside, so a button can be lit — a rich toolbar is a readout, not just a set of actions), `isActive` and `runCommand`. `ShortcutPlugin` registers the keys at `COMMAND_PRIORITY_CRITICAL` and returns `true`, because Lexical has its own ⌘B and ⌘I and would otherwise toggle bold twice. `Panel` no longer touches formatting at all; its `isTextField` counts `isContentEditable` so the arrows stay with the caret.

**The editor's state memory is keyed on the text, not just the note.** Expanding or shrinking swaps one editor for another, and `LoadPlugin` restores the whole serialised state so the caret does not jump to the end. Restoring a state serialised from *different* text would put back what the note no longer says, so the content is part of the key. An unpinned card is a `div` with a covering `data-card` button, not a `<button>`, because checkboxes and links inside a button cannot work. Links go through the `open_url` command (`links.rs`: http/https only, one process argument, no shell) — never let the webview navigate.

**The colour filter row's dots come from the query result, not the visible result**, plus the selected colour even when nothing matches it — otherwise selecting one colour removes the dots needed to switch, and deleting the last note of a colour removes the dot that clears the filter.

Layout: `src/` (dock/, notes/, components/, store/ Zustand, lib/, styles/tokens.css) and `src-tauri/src/` (dock/, platform/, db/, commands.rs, tray.rs, error.rs). Section 10 of the brief has the full tree.

**Panel operations must be marshalled to the main thread at the point of use.** Actions are applied from whatever thread fed the controller — the poll thread, a command, the global shortcut, the single-instance listener — and an AppKit call from the wrong one throws an Objective-C exception Rust cannot catch, aborting the process (a second launch used to kill the running app). `apply_rect`, `focus` and `app_ready`'s `show` all go through `run_on_main_thread`.

**The tray and the shortcut show the panel; they never toggle it.** `tray::show_panel` checks the phase and only opens when collapsed — a menu item called "Open notes" must not close them. Both also ignore a blur for `FOCUS_SETTLE` (1.5 s) after opening: macOS hands focus back to the previously active app about a second after an `Accessory` app activates itself, and brief 6.3's close-on-blur turned that into the panel shutting itself the instant it opened.

### Platform specifics

- **macOS:** A panel opened by the shortcut or tray receives **no keystrokes at all** until it is clicked once — `Cmd+F` does not reach it either, so it is the panel not owning the keyboard rather than the editor losing DOM focus. `focus_panel` is deliberately just `show_and_make_key()`: activation, the `nonactivating` mask and the activation policy were all measured and changed nothing, so none of them are carried. `NoteEditor` re-focuses on the window `focus` event, which makes one click anywhere in the panel enough. The M3 section of `docs/progress.md` has the full table of what is ruled out and the next lead (first responder is the content view, not the `WKWebView`). Do not retry these without reading it. `ActivationPolicy::Accessory` (no Dock icon, no menu bar) and `tauri-nspanel` (pinned commit) to convert the window into a non-activating panel that joins all Spaces and floats over full-screen apps — while still able to become key window so typing works. Panel operations run on the main thread. Keep this isolated in `platform/macos.rs`. `macOSPrivateApi` is required for transparency and rules out the Mac App Store.
- **Windows:** `skipTaskbar` + `alwaysOnTop` cover most behavior. Verify expanding doesn't steal focus before adding any extended window styles.
- **Linux:** X11 direct. When `XDG_SESSION_TYPE=wayland`, set `GDK_BACKEND=x11` at the very top of `main` before Tauri or GTK start (in Rust 2024 `set_var` is `unsafe`; call it before any threads spawn). `LEDGE_NATIVE_WAYLAND=1` opts out.

### Data

**Settings are five inset cards, and the rarely-touched ones fold away.** About is last and is the only one you read rather than change: the version, the system, where `notes.db` lives, a button that copies all three for a bug report, and a link to the downloads page. It comes from the `app_info` command — the version is Tauri's package info, which comes from `package.json` through `tauri.conf.json`, and the data directory is a path, so neither is something the webview should be asking the system for itself. If the command fails the whole section is left out, because a version box that says "unknown" is worse than none.

`SettingsView` draws each group as a card with hairlines between its rows (`Group`), a row's name is primary text with an optional tertiary sentence under it (`Label`), a phase length is nudged rather than typed (`StepperSetting`), and the two hover delays and the panel width sit behind `Advanced`. Fourteen controls in one column read as a wall.

`notes.db` in the app data directory, WAL mode, migrations tracked via `PRAGMA user_version` and run in a transaction at startup. `notes` and `tasks` are separate tables with no foreign key between them: they are separate things. Notes and tasks are soft-deleted (`deleted_at`) so undo works now and sync works later; rows deleted more than 30 days ago are purged at startup. A *completed* task is never purged — finishing something is not a reason to lose the record — it simply stops being listed a day later. IDs are UUID v7. Store only the palette **id** for a note color, never a hex value, so the palette can be retuned. `pinned` is used by note pinning (pinned first, then edit time — `db::notes::list` and `sortNotes` must agree; the tab dots ignore it); `sort_order` is reserved for post-v1.

**The app data folder moved with the rename, and the database is carried across once.** `app_data_dir()` is built from the bundle identifier, so `dev.edgenotes.app` → `dev.ledge.app` in 0.1.0 handed every existing install an empty folder. `db::adopt::adopt_database` copies the old `notes.db` with `VACUUM INTO` — one consistent file from the live connection, `user_version` preserved, where copying the file alone would lose every commit since the last WAL checkpoint — and refuses if the new one already exists. The old folder is never touched.

Never edit a migration that has shipped — append a new one. Repository functions take `now: i64` rather than reading the clock, which is what keeps them deterministic under test. Settings rows are written only when a value changes, so `Settings::default()` is the single source of the brief 9.2 defaults; a malformed stored value falls back to its default rather than failing startup.

**A no-op save is not a save.** `notes_update` bumps `updated_at` and the list sorts by it, so writing when nothing was typed moves a note to the top for having been read. The store keeps what is already stored per note and `flush` returns early when the content matches, updating that record only after a successful write so a failed save still retries.

**A click outside the note leaves the editor only if its text is unchanged.** The store records the text when editing starts (`editBaseline`); `NoteEditor` listens on `window` in the capture phase, judged by where the press started, and calls `leaveEditorIfUnchanged`. Capture phase matters: it closes the editor before a clicked card opens itself.

**A running focus session shows on the collapsed tab.** A red light pulses on the pill while the timer counts, because a collapsed widget's whole job is telling you something without being opened. It is the third agreed exception to brief 7.1's neutral chrome (after the priority flags and the code palette) and the only thing in the app that animates on its own; `contrast.test.ts` holds it above 3:1 on the tab's surface, it pulses at about 0.6 Hz rather than flashing, it never goes fully out, and `prefers-reduced-motion` stops it dead. `focus/session.ts`'s `useSessionRunning` watches for the *end* as well as the start: the timer's state only moves when something asks it to (`settle`), and while the panel is closed nothing asks, so a session that ran out an hour ago would otherwise still be lit. It reads the state and never settles it.

**The tab is a floating pill inside a larger hit box.** `Metrics` `tab_width`/`tab_height` (22×72) are the window and hit area and reach the screen edge; `Tab.module.css` paints a 12×52 pill inside. The owner may ask to reset it to the previous 28×88 flush tab — the progress log's 14 Sep 2026 section records exactly what that was.

**The palette has sixteen colours**, defined in three places that must agree: `NOTE_COLORS` in `ipc.ts`, `NoteColor::ALL` in `db/notes.rs`, and the light and both dark blocks of `tokens.css`. `contrast.test.ts` reads `tokens.css` directly and fails if any of them drift or a pair misses AA.

**Tasks are their own store, and notes know nothing about them.** A task is a row in `tasks` with typed fields (schema v2), not a `- [ ]` line in a note. `db/tasks.rs` owns it, `store/tasks.ts` is the frontend's copy, `TasksView` draws it. A note still renders markdown checkboxes, because an ad-hoc list inside a note is useful, but they are *formatting*: they never reach the Tasks tab, `LineRow` no longer parses details out of them, and `toggleTask` on the notes store is a plain `toggleTaskLine`. The tab is labelled "Tasks" (the view id is still `"todo"`). `TasksView` keeps a task ticked during a visit in place, because completing one moves it to Done and would otherwise reshuffle the list under the cursor.

**The v3 migration moved the old tasks out of notes, once.** `db/task_import.rs` is the only thing that still understands `- [ ] text !high @2026-09-20 14:00 repeat:weekly`; it exists to be run once per database, by the code migration in `migrations.rs`. Migrations are `Sql` or `Code`, both inside the one startup transaction. A note left with nothing but its heading (the old "Tasks" note) is soft-deleted, and note timestamps are not bumped — a migration is not an edit the user made.

**A task's details are columns, and the calendar stays in the frontend.** `due_date`/`due_time` are local calendar values, not instants: "the 20th at 2 pm" means that wherever you are, and Rust has neither a timezone nor a locale to reason about them. So `lib/taskMeta.ts` owns every date decision — sections, ordering, labels, and where a repeat goes next — and `lib/tasks.ts` turns a flat list into the grouped one on screen. Ticking goes through the store's `tick`, which moves a repeating task to its next date with `tasks_update` instead of completing it; `tasks_set_done` is only ever for a task that does not repeat. `TaskPatch` distinguishes an absent key from a null one (Rust reads it with a `present` deserializer), so "clear the due date" and "leave it alone" are different requests. The old tokens survive in one place only: quick entry in the add field, through `parseTaskText`.

**Reminders: the frontend computes, Rust keeps time.** `Panel` sends the full list from `taskReminders` via `reminders_set` after the tasks settle; `reminders.rs` runs one thread that shows each once through `tauri-plugin-notification`, remembering shown ids so re-sending never repeats one. Keep the task format out of Rust.

**An interaction lock is derived from state, never acquired in one place and released in another.** `SearchField` took it in `onFocus` and released it in an effect cleanup, and React's mount/cleanup/mount cycle dropped it: re-focusing an already-focused input fires no event, so nothing took it back and the panel slid away mid-search. Hold a lock in a `useEffect` keyed on the state that justifies it; `setLock` is idempotent and only talks to Rust when the aggregate flips.

**An explicit dismissal suppresses hover until the cursor leaves.** Brief 6.1 reverses a close when the cursor *re-enters*, which presumes it left. Without `dismissed`, Esc with the mouse resting on the panel reversed instantly and looked dead, and Keep open made the panel impossible to dismiss at all.

**The notes list does not re-sort while the editor is open.** Notes sort by `updated_at` descending, so re-sorting on each keystroke would pull the card being edited out from under the cursor. `setContent` updates optimistically without reordering; the list re-sorts in `stopEditing`. Restore deliberately leaves `updated_at` alone so an undone delete returns to its old position.

## Conventions

- TypeScript strict, no `any`. Rust: no `unwrap`/`expect` outside startup code and tests.
- Styling is CSS Modules plus one `tokens.css`; no UI kit, no Tailwind. Note colors are the only color — chrome is neutral, one accent used only for focus rings and active Keep open.
- Two font weights (400, 600), sentence case, 4 px spacing grid, no emoji or gradients.
- Nothing essential may be hover-only: on macOS an inactive window may never see hover. Hover styles are an enhancement.
- `cursor: default` on buttons and cards; text cursor only in text fields.
