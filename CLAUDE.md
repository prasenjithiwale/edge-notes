# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rules

- The full spec is `docs/build-brief.md`. Read it before any task.
- Current status, decisions, and platform findings are in `docs/progress.md`. Read it before any task and update it at the end of every milestone.
- Work on one milestone at a time. Stop when it's done. At the end of each milestone, summarize what changed and give a manual test checklist before continuing.
- Don't add dependencies outside section 4 of the brief without asking.
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

**Keyboard handling is one window-level listener, and the interaction lock is counted.** `Panel` binds a single `keydown` listener on `window` — not on the panel element, because closing the editor or the search field unmounts the focused node and a subtree handler then never sees another key. Esc resolves as one ordered cascade there (settings, editor, expanded note, search, then panel); components handle no keys themselves. Every panel shortcut is gated on `isExpandedPhase`, since the webview can hold key focus after a collapse and Esc must never toggle a collapsed panel open. The editor and the search field can both hold the panel open, so `dock.setLock(owner, held)` keeps a set of owners and calls `dock_set_interaction_lock` only when the aggregate flips; Rust still sees one boolean. The search field locks on focus, not while mounted.

**Formatting is Markdown markers in plain text, never markup.** `src/lib/markdown.ts` holds the pure parser and edit transforms; `src/notes/formatting.ts` applies them to the textarea through `execCommand("insertText")` so `Cmd+Z` still works — assigning `value` destroys the undo stack. Formatting keys and Enter-continues-a-list live in `Panel`'s window listener, gated on the `data-note-editor` textarea. An unpinned card is a `div` with a covering `data-card` button, not a `<button>`, because checkboxes and links inside a button cannot work. Links go through the `open_url` command (`links.rs`: http/https only, one process argument, no shell) — never let the webview navigate.

**The colour filter row's dots come from the query result, not the visible result**, plus the selected colour even when nothing matches it — otherwise selecting one colour removes the dots needed to switch, and deleting the last note of a colour removes the dot that clears the filter.

Layout: `src/` (dock/, notes/, components/, store/ Zustand, lib/, styles/tokens.css) and `src-tauri/src/` (dock/, platform/, db/, commands.rs, tray.rs, error.rs). Section 10 of the brief has the full tree.

**Panel operations must be marshalled to the main thread at the point of use.** Actions are applied from whatever thread fed the controller — the poll thread, a command, the global shortcut, the single-instance listener — and an AppKit call from the wrong one throws an Objective-C exception Rust cannot catch, aborting the process (a second launch used to kill the running app). `apply_rect`, `focus` and `app_ready`'s `show` all go through `run_on_main_thread`.

**The tray and the shortcut show the panel; they never toggle it.** `tray::show_panel` checks the phase and only opens when collapsed — a menu item called "Open notes" must not close them. Both also ignore a blur for `FOCUS_SETTLE` (1.5 s) after opening: macOS hands focus back to the previously active app about a second after an `Accessory` app activates itself, and brief 6.3's close-on-blur turned that into the panel shutting itself the instant it opened.

### Platform specifics

- **macOS:** A panel opened by the shortcut or tray receives **no keystrokes at all** until it is clicked once — `Cmd+F` does not reach it either, so it is the panel not owning the keyboard rather than the editor losing DOM focus. `focus_panel` is deliberately just `show_and_make_key()`: activation, the `nonactivating` mask and the activation policy were all measured and changed nothing, so none of them are carried. `NoteEditor` re-focuses on the window `focus` event, which makes one click anywhere in the panel enough. The M3 section of `docs/progress.md` has the full table of what is ruled out and the next lead (first responder is the content view, not the `WKWebView`). Do not retry these without reading it. `ActivationPolicy::Accessory` (no Dock icon, no menu bar) and `tauri-nspanel` (pinned commit) to convert the window into a non-activating panel that joins all Spaces and floats over full-screen apps — while still able to become key window so typing works. Panel operations run on the main thread. Keep this isolated in `platform/macos.rs`. `macOSPrivateApi` is required for transparency and rules out the Mac App Store.
- **Windows:** `skipTaskbar` + `alwaysOnTop` cover most behavior. Verify expanding doesn't steal focus before adding any extended window styles.
- **Linux:** X11 direct. When `XDG_SESSION_TYPE=wayland`, set `GDK_BACKEND=x11` at the very top of `main` before Tauri or GTK start (in Rust 2024 `set_var` is `unsafe`; call it before any threads spawn). `EDGE_NOTES_NATIVE_WAYLAND=1` opts out.

### Data

`notes.db` in the app data directory, WAL mode, migrations tracked via `PRAGMA user_version` and run in a transaction at startup. `notes` and `tasks` are separate tables with no foreign key between them: they are separate things. Notes and tasks are soft-deleted (`deleted_at`) so undo works now and sync works later; rows deleted more than 30 days ago are purged at startup. A *completed* task is never purged — finishing something is not a reason to lose the record — it simply stops being listed a day later. IDs are UUID v7. Store only the palette **id** for a note color, never a hex value, so the palette can be retuned. `pinned` is used by note pinning (pinned first, then edit time — `db::notes::list` and `sortNotes` must agree; the tab dots ignore it); `sort_order` is reserved for post-v1.

Never edit a migration that has shipped — append a new one. Repository functions take `now: i64` rather than reading the clock, which is what keeps them deterministic under test. Settings rows are written only when a value changes, so `Settings::default()` is the single source of the brief 9.2 defaults; a malformed stored value falls back to its default rather than failing startup.

**A no-op save is not a save.** `notes_update` bumps `updated_at` and the list sorts by it, so writing when nothing was typed moves a note to the top for having been read. The store keeps what is already stored per note and `flush` returns early when the content matches, updating that record only after a successful write so a failed save still retries.

**A click outside the note leaves the editor only if its text is unchanged.** The store records the text when editing starts (`editBaseline`); `NoteEditor` listens on `window` in the capture phase, judged by where the press started, and calls `leaveEditorIfUnchanged`. Capture phase matters: it closes the editor before a clicked card opens itself.

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
