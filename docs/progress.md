# Edge Notes: progress

Status, decisions and platform findings. Read before any task; update at the end
of every milestone. The spec is [build-brief.md](build-brief.md).

## Milestone status

| Milestone | Status |
|---|---|
| M0 Docking spike | Built. **The window never appeared until 12 Sep 2026**, and **typing never worked until the same day** — see below. Checklist now run on macOS except the items noted; Windows and Linux untested. |
| M1 Notes core | Built and accepted on macOS: the checklist below was run against the running app. |
| M2 Find and organize | Built and accepted on macOS: the checklist below was run against the running app. |
| M3 System integration | Built and verified on macOS, with one known gap (keyboard focus after the shortcut). |
| M4 Polish | Built and verified on macOS. Only the GPU power measurement is outstanding, and it needs `sudo`. |
| M5 Packaging | Not started |

Built and verified on macOS 26.6.2 (Tahoe), Apple Silicon, single 1920×1080
display at 1× scale. Every scaling and multi-monitor case is covered by unit
tests but has not been seen on real hardware.

**The M0 checklist was never reported as run**, and that hid a total failure for
three milestones: the window never became visible at all (below). Screen capture
now works for the agent, so the collapsed tab has been seen on screen. Anything
needing the cursor — every hover, click and keystroke item — is still unverified,
because macOS Accessibility is not granted to the agent's host process.

## The window was invisible (fixed 12 Sep 2026)

For all of M0, M1 and M2 the app started, converted to an NSPanel, logged
nothing, and **drew nothing on screen**. It was never a docking or geometry bug.

`DockShell` called `app_ready` — the command that shows the window — from inside
two nested `requestAnimationFrame` callbacks, to wait for the first paint
(brief 7.5). But the window is created with `visible: false`, and **WebKit
suspends `requestAnimationFrame` in a window that has never been ordered in**.
The callbacks never ran, so `app_ready` was never called, so the window was never
shown, so the callbacks never ran: the window stayed hidden because it was
hidden. Nothing reached stderr, because nothing failed — the frontend was simply
waiting for a frame that could not arrive.

How it was found, after CSP and the frontend were both wrongly suspected: a
temporary `eprintln!` in `app_ready` proved it was never called; jsdom proved the
frontend calls it correctly when Tauri behaves (so the bug was environmental);
and flipping the window to `visible: true` made `app_ready` fire instantly, which
named the cause exactly.

The fix, in `DockShell`: keep the double-frame wait, but race it against a 120 ms
fallback that shows the window anyway, whichever comes first. On a cold start the
fallback is what fires; on a reload, with the window already on screen, the frames
win and the paint wait is real. A rejected `listen()` no longer strands the window
either — it is caught, logged, and the window is still shown, because a panel
that misses an event is better than a widget nobody can see.

Both paths are now regression-tested in `src/dock/DockShell.test.tsx`.

**Ruled out along the way, so nobody re-investigates them:** the CSP is *not* the
problem (the app works with it removed *and* restored, and Tauri's
`security.devCsp` is unnecessary here, though note that `csp` does apply in dev
when `devCsp` is unset); the ACL capability is correct; and the frontend
handshake is correct under StrictMode's double-invoked effects.

## Open gaps

Standing list of what is known to be wrong or unverified. Read this before
planning a milestone; nothing here is fixed by the work that follows it.

1. **A panel opened by the shortcut or tray receives no keystrokes until it is
   clicked once.** `Cmd+F` does not reach it either, so the panel does not own the
   keyboard — this is not the editor losing DOM focus. Eight approaches were
   measured and ruled out; the table, the mitigation that is kept (one click
   *anywhere* in the panel focuses the editor) and the next lead (first responder
   is the content view, not the `WKWebView`) are in the M3 section below. **Do not
   retry those eight without reading it.** Affects brief 6.11 and 8.6.
2. **Platform coverage that has never run on real hardware.** The panel over
   full-screen apps and across Spaces; 150% and 200% scaling; a secondary monitor;
   and Windows and Linux entirely. Scaling and multi-monitor are covered by unit
   tests only — this machine is a single 1920×1080 display at 1×. Everything built
   since M0 assumes placement is sound, so a real failure here lands on work built
   on top of it.
3. **CSS wiring and the slide animation handshake have no test.** A selector that
   matches nothing still looks identical to a passing build.

Closed: the test data left in the notes database by the checklist runs was purged
on 13 Sep 2026, settings rows included, so the database is back to a fresh-install
state.

## Commands

Node 24 is required (`.nvmrc`); Homebrew's Node 25 on `PATH` is outside Vitest 5's
supported range, so run `nvm use` first in a fresh shell.

```bash
nvm use                      # Node 24 (nvm reads .nvmrc)
npm install

npm run tauri dev            # run the app
npm run tauri build          # release bundle (.app, .dmg)
npm run tauri build -- --bundles app   # .app only, much faster

npm run lint                 # ESLint, zero warnings allowed
npm test                     # Vitest
npx tsc --noEmit             # type check
npx vitest run src/lib/dock.test.ts    # one test file
npx vitest run -t "flips the chevron"  # one test by name

cd src-tauri
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
cargo test dock::controller            # one module
cargo test hover_intent                # one test
```

## Verified API findings (Tauri 2.11.5, September 2026)

Checked against the crate source and the current docs, not from memory.

- **No atomic bounds API exists.** `crates/tauri/src/window/mod.rs` in 2.11.5 has
  no `bounds` or `set_bounds` — only `set_position` and `set_size`. This matters
  because a right dock must hold `x + width` pinned to the screen edge, so a
  single call can never be correct. See the decision below.
- `Monitor::work_area() -> &PhysicalRect<i32, u32>` exists, so brief 8.5 is valid.
- `AppHandle::cursor_position()`, `available_monitors()`, `primary_monitor()` and
  `monitor_from_point()` all exist as the brief describes.
- `App::set_activation_policy` and `AppHandle::set_activation_policy` both exist
  on macOS. (docs.rs builds on Linux, so macOS-only items are invisible there —
  check the source, not docs.rs, for anything platform-gated.)
- Every window key in brief 8.7 is a real `WindowConfig` field under those exact
  camelCase names. `transparent` additionally needs the `macos-private-api`
  **Cargo feature**, not just `app.macOSPrivateApi`.
- **App-defined commands are not gated by the ACL.** Only `core:event:allow-listen`
  and `allow-unlisten` are needed in `capabilities/default.json`. They can be
  restricted later via `AppManifest::commands` in `build.rs`.
- `tauri-nspanel` v2.1 no longer has a bare `to_panel()`. A panel class is
  declared with the `tauri_panel!` macro and passed as a type parameter:
  `window.to_panel::<DockPanel>()`. Pinned at commit `c9ec2130`. Its own
  `examples/hover_activate` is the closest reference for this use case.

### Open upstream issues that shape the design

| Issue | State | Effect here |
|---|---|---|
| [#11386](https://github.com/tauri-apps/tauri/issues/11386) inactive macOS windows get no mouse events | open | The reason hover detection polls the cursor in Rust instead of using DOM events. Premise confirmed, not stale. |
| [#15170](https://github.com/tauri-apps/tauri/issues/15170) monitor/cursor queries crash under load | closed, **unreleased** | Fixed by PR #15630, milestoned 2.12; newest published is 2.11.5. Mitigated below. Revisit when 2.12 ships. |
| [#15471](https://github.com/tauri-apps/tauri/issues/15471) `transparent: true` recomposites every frame on macOS | open | ~620 mW vs ~75 mW GPU on a static page. Conflicts with the near-idle target in brief 11. **Unmeasured here — see known issues.** |
| [#13415](https://github.com/tauri-apps/tauri/issues/13415) transparency lost in a bundled `.app` | open | Would surface at M5. A release bundle is built now so it can be checked early. |

## The panel could never be typed into (fixed 12 Sep 2026)

Found while running the M0 checklist: clicking a note opened its editor, but every
keystroke went to the app *underneath* instead of the panel. Proof was accidental
and unambiguous — automated keystrokes meant for the editor were typed into the
owner's editor window and sent as a chat message.

`platform/macos.rs` set `becomes_key_only_if_needed: true`. AppKit's
`becomesKeyOnlyIfNeeded` gives a panel key status **only** when the click lands on
a view it knows needs keys, meaning an `NSTextField`. The entire webview is one
`NSView`, so AppKit can never tell that an HTML `<textarea>` wants input: the panel
never became key and nothing could be typed anywhere in it — the editor or the
search field.

Now `false`. Hover still takes no focus, because hover is not a click, and
`nonactivating_panel` still keeps a click from activating the app (verified: the
frontmost app stays the one the user was in). Verified after the change by typing
into a note and watching the character reach SQLite through the autosave.

This is a change inside `platform/macos.rs`, which the project rules put
off-limits by default; the dock tests (44) and the full Rust suite (72) were run
after it, as those rules require.

## Decisions

**Hand-written scaffold instead of `create-tauri-app`.** The generator is
interactive and its layout does not match brief section 10. Every config file was
written directly so the tree matches the spec.

**The window rect is applied as two calls inside one main-thread closure.** Since
Tauri has no atomic bounds API, `poller::apply_rect` issues `set_position` and
`set_size` back to back inside a single `run_on_main_thread` closure, so both land
in the same run-loop turn and the compositor presents one update. The order is
chosen by `geometry::apply_order`: move first when growing, resize first when
shrinking, so any stray intermediate frame keeps the window on screen rather than
pushing it past the edge. *This is a change from the original plan, which was to
use `NSPanel::setFrame_display_` on macOS.* That path needs flipped bottom-left
NSRect coordinates in points and is easy to get wrong on multi-monitor setups; it
is held in reserve and should only be built if a jump is actually visible.

**Frontend layout is anchored to the docked edge and never changes shape.** The
tab and panel form one group anchored to the edge, with the closed state at
`translateX(±panel-width)`. Because the collapsed and expanded windows share that
edge, the group renders the tab on exactly the same screen pixels at both window
sizes — so the resize reveals nothing and the tab does not move (brief 8.4). Only
the transform changes between phases; no layout switch, no reflow.

**`tabTop` is computed from the real tab position, not assumed centred.** Near the
top or bottom of the screen the panel gets clamped into the work area, so it is no
longer centred on the tab. Sending the measured offset in `dock:state` is what
keeps the tab still during the resize in those positions.

**Monitor queries are marshalled to the main thread.** `poller::monitor_snapshot`
sends the query through `run_on_main_thread` and a channel with a 500 ms timeout —
which is what the unreleased upstream fix for #15170 does. Cursor sampling still
runs on the poll thread: it happens at up to 30 Hz and routing it through the main
thread every tick would add latency and main-thread load for a crash pattern whose
reproduction needed 20 concurrent threads in tight loops. One poller thread,
adaptive 33/150 ms, and the monitor list refreshed at most every 2 s while
collapsed.

**Turning Keep open off restarts the close delay** rather than closing on a
timestamp that may be minutes old, matching how the interaction lock already
behaves. Found by a failing test, not by inspection.

**Blur clears the interaction lock.** If another app takes focus, no field of ours
still holds it, so the lock is dropped and the close delay starts. Without this a
panel left with a focused field would stay open forever.

**Opening has an acknowledgment timeout too.** Brief 8.4 only specifies one for
closing. Without a matching guard, a lost `dock_animation_done("opening")` would
strand the panel in `opening` and auto-close would never run.

## Fixes after the first M0 pass

Found by re-reading the code, not by running it. All five are in the M0 scope.

1. **Cross-module CSS selectors never matched.** `Tab.module.css` used
   `:global(.right) .tab`, but the side was applied as a CSS Module class, which
   is hashed per file — so the literal `.right` never existed in the DOM. The tab
   had no border radius and the chevron never flipped. The side is now a
   `data-side` attribute on the viewport, which is global and works across
   modules. The chevron rotation was also inverted; it now points toward the
   screen centre while collapsed and back toward the edge when open.
2. **Reduced motion hid the tab.** The 80 ms fade was applied to the whole group,
   which contains the tab, so `prefers-reduced-motion` made the collapsed tab
   invisible — the one element that must always be on screen. The fade is now on
   the panel alone.
3. **The first `dock:state` could be lost.** `app_ready` was called from `App`
   while the listener was registered in `DockShell`, and `listen()` resolves
   asynchronously, so showing the window could emit before anything was
   listening. Both now live in one effect, ordered: listen, then paint, then
   `app_ready`.
4. **The Linux `pointerleave` signal was not wired.** `Input::PointerLeftWebview`
   existed and was tested but nothing sent it, so brief 8.2's secondary signal was
   missing. Added `dock_pointer_left` plus an `onPointerLeave` handler. Sent on
   every platform; the controller ignores it unless the cursor really is outside.
5. **The poll thread had no stop path.** It now stops on `WindowEvent::Destroyed`
   instead of relying on process exit.

Only the panel and the group carry `data-slide="true"`, and only those elements'
transition ends acknowledge an animation — the chevron animates `transform` too
and would otherwise fire a spurious acknowledgment.

**Testing gap this exposed:** CSS wiring is not covered by any test. Vitest runs
in a `node` environment against pure logic, so a selector that silently matches
nothing looks identical to a passing build. Worth considering a DOM environment
and a couple of render tests before the notes UI grows.

## Deviations from the brief

- `create-tauri-app` was not used (above).
- The panel is clamped so its *shadow margin* stays inside the work area, not just
  its visible edge. Costs 12 logical px of travel at the extremes; keeps the shadow
  from being clipped by the screen edge.
- Vite's `build.sourcemap` is not wired to `TAURI_ENV_DEBUG`, because reading
  `process.env` in `vite.config.ts` would require adding `@types/node`, which is
  outside brief section 4. Revisit if source maps are wanted in debug bundles.
- `lucide-react` and `zustand` are installed and used; `@types/react`,
  `@vitejs/plugin-react`, `typescript-eslint`, `@eslint/js` and
  `eslint-plugin-react-hooks` were added as toolchain devDependencies to satisfy
  the ESLint and strict-TypeScript requirements in brief 11.

## Known issues and untested areas

1. **Partly visually verified as of 12 Sep 2026.** Screen capture works for the
   agent after all; the earlier note saying otherwise was wrong. Confirmed by
   screenshot: the collapsed tab sits at the right edge, vertically centred,
   rounded only on the inner side, above the focused app, with the chevron
   pointing toward the screen centre — and, with notes in the database, the three
   recent-colour dots in the right colours and order (brief 6.5).
   **Still unverified: everything needing the cursor or keyboard.** macOS
   Accessibility is not granted to the agent's host process, so `cliclick` cannot
   move the pointer and System Events cannot send keys — and hover is the only way
   to open the panel until the tray and shortcut land in M3. Granting
   Accessibility to the terminal host (System Settings → Privacy & Security →
   Accessibility) would unblock the rest of the checklists.
2. **The transparency GPU cost (#15471) was not measured.** `powermetrics` needs
   `sudo` and an interactive password. Run it by hand:
   `sudo powermetrics --samplers gpu_power -i 1000 -n 5` with the panel collapsed
   and idle. The collapsed window is only 28×88 px, so the composited area is tiny
   for almost all of its life, but this needs a number before M4.
3. **Windows and Linux are untested.** `platform/windows.rs` and
   `platform/linux.rs` are deliberately near-empty: brief 8.9 says to verify focus
   behaviour before adding any window styles.
4. **Multi-monitor, and 150%/200% scaling, are covered only by unit tests.**
5. **`dock.monitor` is always the primary monitor.** The setting lands in M1 with
   the rest of the settings store; the fallback logic in brief 8.5 is not built.
6. **`tab_offset` is fixed at 0.5.** Dragging the tab is M4.
7. Errors currently go to stderr via `eprintln!`. `tauri-plugin-log` arrives in M3.

## M1: notes core

SQLite with migrations, the notes and settings commands, typed IPC, the notes
store, card list, inline editor with autosave, delete with undo, and the empty
state. Search, the colour filter row, the editor's colour swatches and the
"edited 2h ago" line are M2.

### Decisions

**The list does not re-sort while you type.** Notes sort by `updated_at`
descending, so live re-sorting would yank the card you are editing to the top
mid-sentence. `setContent` updates content optimistically but leaves the order
alone; the list re-sorts when the editor closes.

**Restore does not touch `updated_at`.** An undone delete returns to its old
position in the list instead of jumping to the top, because undoing a mistake is
not an edit.

**Empty notes are discarded with a soft delete and no toast.** Brief 6.9 says an
empty note is discarded when the editor closes; there is nothing in it worth
offering to undo. It leaves a tombstone row, which the 30-day purge collects.

**Settings rows are written only when changed.** A fresh database has zero rows
in `settings` and every value comes from `Settings::default()`, so the defaults
in brief 9.2 live in exactly one place. A malformed or future-version value falls
back to its default rather than failing startup.

**Sort has an id tiebreak.** Two notes saved in the same millisecond would
otherwise swap places on every reload.

**`notes_create` also writes `notes.lastColor`**, which is what makes the next
new note reuse the last colour (brief 6.9) without a second round trip.

### Verified at runtime

The database is created at
`~/Library/Application Support/dev.edgenotes.app/notes.db` in WAL mode at
`user_version = 1`, with the `notes` and `settings` tables and the
`idx_notes_active` index exactly as specified in brief 9.1.

### M1 acceptance checklist

- [ ] The panel opens to "Capture your first note" on a fresh install
- [ ] New note (+) creates a card at the top and opens it in the editor
- [ ] Typing autosaves: close the panel, reopen, and the text is still there
- [ ] The card title is the first line and the preview is the rest, clamped to two lines
- [ ] The panel does not close while the editor has focus, even with Keep open off
- [ ] Esc closes the editor and leaves the panel open
- [ ] Done closes the editor and the list re-sorts to most-recently-edited first
- [ ] Delete shows "Note deleted" with Undo, and Undo puts the note back in place
- [ ] The toast disappears after about 5 seconds
- [ ] Opening a note, typing nothing and closing discards it — no empty card is left
- [ ] Notes survive a full quit and relaunch
- [ ] Cards use the palette colours and are readable in both light and dark mode

## M2: find and organize

Search, the colour filter row, keyboard navigation, the editor footer (colour
swatches and the edited-time line), and the interaction lock while editing or
searching. No Rust changed: every command and event M2 needs already existed
after M0, so `dock/` and `platform/` were not touched and the dock tests were
left as they were (still 72 passing).

Also built here, having been missed in M1: the tab's three recent-note colour
dots (brief 6.5). `Tab.tsx` carried a comment promising them for M1; they need
note data, which only existed from M1 onwards.

### Decisions

**One keyboard handler on the window, not on the panel element.** Closing the
editor or the search field unmounts the focused node and focus falls back to the
body — a React handler bound to the panel subtree then never sees another key, so
Esc and the arrows would go dead after exactly one use. The listener reads store
state through `getState()`, so it registers once and cannot act on a stale
snapshot.

**The Esc cascade is one ordered decision, not three handlers.** Brief 6.11 wants
editor, then search, then panel. That was first built as each component
swallowing its own Esc with `stopPropagation`, which depends on React's synthetic
propagation reaching a native window listener — subtle, and it broke as soon as
the handler moved to the window. The cascade now lives in one place and the
components handle no keys at all.

**Panel shortcuts are scoped to an expanded panel.** A window-level listener also
fires while the panel is collapsed, and the webview can still hold key focus
after a collapse. Without the guard, Esc on a collapsed panel called
`dock_toggle` and *opened* it — the opposite of what Esc means. `isExpandedPhase`
mirrors Rust's `Phase::is_expanded`.

**The interaction lock is counted by owner, not a boolean.** The editor and the
search field can both hold the panel open (brief 6.3). With a single flag,
closing the editor while the search field still had focus released a lock that
was still needed. `dock.setLock(owner, held)` keeps a set and only calls
`dock_set_interaction_lock` when the aggregate flips, so Rust still sees one
boolean and its state machine is unchanged.

**The search field locks on focus, not while mounted.** Locking for as long as
the field existed meant opening search and walking away pinned the panel open
indefinitely. Brief 6.3 says *has focus*, which is also the behaviour that can't
strand the panel. Blur with an empty query returns the header to the title.

**The filter row's dots come from the query result, not the visible result.**
Deriving them from the fully filtered list would remove every other dot as soon
as one colour was selected, leaving no way to switch colours. The selected colour
is also always kept, even when nothing matches it any more — otherwise deleting
the last note of that colour takes away the dot that clears the filter.

**A new note clears the active filters.** It is empty and carries the last-used
colour, so a running search or a colour filter would hide the very card the
editor is about to open in.

**Closing the editor returns focus to its card.** Otherwise focus lands on the
body and the next arrow key re-enters the list from the top, so Enter-Esc-arrow
silently loses your place. Arrow movement reads focus from the DOM rather than
mirroring an index in the store, which would drift after a delete or a re-sort.

**The clock is read through `useSyncExternalStore`, not `Date.now()` in render.**
The edited-time line needs the wall clock, which is external mutable state;
calling `Date.now()` during render is impure and the React lint rule rejects it.
The snapshot is quantised to 30 s so repeated reads inside one render agree, and
that also sets how often the editor re-renders for the label.

### Deviations from the brief

- Brief 6.9 asks for the edited-time line in tertiary text, but the editor sits on
  a coloured card and a neutral gray on it would not hold AA. It uses the note's
  paired text colour at reduced emphasis instead, as the card preview already does.
- The editor footer is two rows (swatches, then the meta line with delete and
  Done). Seven swatches plus a timestamp plus two buttons do not fit on one row at
  a 320 px panel width without crowding.
- `editedLabel` is self-contained rather than locale-formatted, so it is
  deterministic under test: just now, `Xm`, `Xh`, `Xd`, then `Xmo` on 30-day
  months. A future `updatedAt` reads as "just now" rather than a negative age.
- Brief 6.10 names no empty state for a colour filter that matches nothing, which
  is reachable by filtering and then searching. It shows "No notes in this
  colour" rather than a blank panel.
- `usedColors` from M1 was removed: `facetColors` with no selection is exactly it,
  and two ways to do the same thing is one too many.

### Component tests (approved addition)

`jsdom`, `@testing-library/react` and `@testing-library/dom` were added as
devDependencies with the owner's approval, closing the gap flagged in M0 and M1.
They are outside brief section 4, which lists only `cargo test` and Vitest.

`vite.config.ts` keeps `environment: "node"` as the default so the pure-logic
tests stay fast; component tests opt in per file with a
`// @vitest-environment jsdom` docblock. Frontend tests: 64 across 6 files, up
from 29 in one.

What they cover: the startup handshake (both the cold-start path that was broken
for three milestones and a failing `listen()`), the Esc cascade in all four of its
cases including the collapsed panel, `Cmd+F` and `Cmd+N`, search filtering and the
no-matches message, colour filtering and the facet rule that keeps the other dots
reachable, arrow-key card movement, and the counted interaction lock.

Still uncovered: CSS wiring (a selector that matches nothing still looks identical
to a passing build) and the slide animation handshake.

### M2 acceptance checklist

- [ ] The search icon replaces the title with a search field, and typing filters the list
- [ ] Esc in the search field clears it and the title comes back; a second Esc collapses the panel
- [ ] Clicking away from an empty search field restores the title
- [ ] The panel does not close while the search field has focus, with Keep open off
- [ ] `Cmd+F` opens search and `Cmd+N` makes a note, both while the panel is open
- [ ] Neither shortcut, nor Esc, does anything once the panel is collapsed
- [ ] A search with no matches shows: No notes match “…”
- [ ] The filter row shows All plus one dot per colour in use, and no dot for unused colours
- [ ] Clicking a dot filters to it; clicking it again or All clears it, and the ring is visible
- [ ] Filtering to one colour still leaves the other dots available to switch to
- [ ] New note while a search or colour filter is active still opens its editor
- [ ] Arrow keys move between cards, Enter opens one, and Esc puts focus back on that card
- [ ] Arrow keys inside the editor and the search field move the caret, not the selection
- [ ] The editor footer shows seven swatches, the selected one ringed, and clicking one recolours the note and the card
- [ ] The footer reads "Edited just now" on a new note, and sensibly on an older one
- [ ] The next new note reuses the colour last chosen in the editor
- [x] The tab shows up to three dots in the colours of the three most recently edited notes — verified by screenshot
- [ ] Text on every note colour is readable in both light and dark mode, swatches included

## Checklist run of 12 Sep 2026 (macOS only)

Run by driving the real cursor with `cliclick` and reading the screen with
`screencapture`, after the owner granted Accessibility. Everything marked here was
seen on screen or in the database, not inferred.

**On delivering keys to a nonactivating panel:** `cliclick`'s `kp:` events never
arrive (a Return in the editor produced no newline, and Esc did nothing), while
typed characters and Cmd-combinations do. `osascript -e 'tell application "System
Events" to key code N'` delivers all of them correctly and is what the keyboard
items below were verified with. Anyone re-running this checklist should use that.

The remaining limit is hardware: one 1920×1080 display at 1×, so scaling and
multi-monitor placement are still unverified.

### Found while running it — all fixed on 13 Sep 2026

1. **The panel could not be typed into at all** — fixed, above.
2. **Opening a note and closing it rewrote `updated_at`.** No edit required:
   `stopEditing` always called `flush`, which sends `notes_update` and bumps the
   timestamp, so merely reading a note jumped it to the top of the list — the same
   problem the restore path already avoids deliberately. The store now remembers
   what is in the database per note and `flush` returns early when nothing was
   typed; the saved value is only updated after a successful write, so a failed
   save still retries. Verified on the running app: opening a note and pressing
   Done left `updated_at` untouched.
3. **The panel collapsed while it was being used.** Tracing the real app showed the
   blur path was innocent — the sequence was `lock: true` then `lock: false` with
   no blur at all. `SearchField` took the lock in `onFocus` but released it in an
   effect cleanup, and React's mount/cleanup/mount cycle dropped it: re-focusing an
   already-focused input fires no event, so nothing took it back and the panel slid
   away mid-search. The lock is now derived from state and re-asserted, never
   acquired in one place and released in another. Verified on the running app: the
   panel now holds with the cursor 1200 px away while a query is typed.
4. **Esc could not dismiss the panel while the cursor rested on it.** `on_cursor`
   reversed any close the moment it saw the cursor inside, but brief 6.1 says the
   cursor *re-enters*, which presumes it left. With the cursor sitting on the panel
   the close reversed instantly, so Esc appeared dead — and with Keep open on
   nothing could dismiss the panel at all. An explicit dismissal (Esc, shortcut,
   tray) now suppresses hover until the cursor is seen outside. This is a change in
   `dock/controller.rs`, which the project rules put off-limits by default; the
   dock tests were extended to 47 and run, as those rules require.

### Verified on screen

- [x] Tab visible at the right edge, above other apps, no Dock icon and no menu bar
- [x] Hovering while another app is focused opens the panel and does not steal focus
      (frontmost app stayed the browser, before and after)
- [x] Leaving closes the panel after the delay
- [x] Re-entering during the close reverses it back to open
- [x] The first click inside the panel works while another app is active
- [x] Typing into the editor works after clicking in, and reaches SQLite (after the fix)
- [x] No flash or jump at startup, open or close
- [x] Cards: first line as title, rest as preview, palette colours, readable in dark mode
- [x] The list does not re-sort while the editor is open, and re-sorts on close
- [x] The panel stays open while the editor is open, cursor 900 px away, Keep open off
- [x] New note (+) creates an empty card at the top, opens it, and uses the last colour
- [x] A new note clears an active colour filter so the new card is visible
- [x] Done closes the editor and the list re-sorts
- [x] Delete soft-deletes and shows "Note deleted" with Undo; Undo restores the note
- [x] Notes survive a full quit and relaunch, including an autosaved edit
- [x] Search icon and Cmd+F both open the search field, with the accent focus ring
- [x] Typing in search filters the list; no matches shows: No notes match “…”
- [x] Clicking away from an empty search field restores the title
- [x] The panel stays open while the search field has focus
- [x] Filter row shows All plus one dot per colour in use, and no dot for unused colours
- [x] Clicking a dot filters to it and shows the selection ring; clicking again clears it
- [x] Filtering to one colour leaves the other dots available to switch to
- [x] Editor footer: seven swatches with the current colour ringed, delete and Done
- [x] The edited line reads "Edited 1h ago" and becomes "Edited just now" after a keystroke
- [x] The tab shows the three most recent note colours, in order

### Verified after the fixes (13 Sep 2026)

- [x] Esc closes the editor, and focus returns to the card that was being edited
- [x] A second Esc clears the search query and brings the title back
- [x] A third Esc collapses the panel, including with the cursor resting on it
- [x] Hover opens the panel again normally once the cursor has left and returned
- [x] Arrow keys move focus between cards, with the focus ring visible
- [x] Enter opens the focused card in the editor
- [x] Keep open holds the panel open with the cursor 1200 px away, and the pin
      turns the accent colour
- [x] A colour swatch recolours the note and its card, and the filter row drops a
      colour once no note uses it
- [x] An empty note is discarded when the editor closes: no empty card, no toast
- [x] The toast disappears on its own after about five seconds
- [x] Opening a note and closing it no longer moves it in the list
- [x] The panel holds open while a query is typed with the cursor far away

### Still not covered

- [ ] The panel over full-screen apps and on every Space
- [ ] 150% and 200% scaling, and a secondary monitor (single 1× display here)
- [ ] Windows and Linux entirely

## M3: system integration

Tray menu, live dock side switching, launch at login, the global shortcut, single
instance and logging. The Linux Wayland fallback that M3 also lists was already
built in M0 (`platform::linux::prepare_display_backend`) and is unchanged.

Dependencies added, all from brief section 4: `tauri-plugin-single-instance`,
`tauri-plugin-autostart`, `tauri-plugin-global-shortcut`, `tauri-plugin-log`, the
`tray-icon` feature on `tauri`, and `log` as the façade the plugin logs through.

### Decisions

**The tray and the shortcut show the panel; they never hide it.** `dock_toggle`
would close an already-open panel, which is wrong for a menu item called "Open
notes". `tray::show_panel` checks the phase first and only toggles when collapsed.

**Panel operations are marshalled to the main thread at the point of use.** Brief
8.8 says panel operations run on the main thread, and `apply_rect` already did —
but taking focus did not, and actions are applied from whatever thread fed the
controller. The single-instance listener is one such thread, and the AppKit call
from it threw an Objective-C exception that Rust cannot catch: **launching a
second copy aborted the running app.** `focus` and `app_ready`'s `show` now both
go through `run_on_main_thread`.

**A blur in the first moments after a deliberate open is ignored.** macOS hands
focus back to the previously active app about a second after an `Accessory` app
activates itself. Brief 6.3 closes a shortcut-opened panel when another app takes
focus, so that bounce made the panel shut itself the instant the shortcut opened
it. `FOCUS_SETTLE` (1.5 s) distinguishes the window server settling from the user
switching away.

**Launch-at-login state is read from the OS, not mirrored into settings.** The
user can remove the login item outside the app, so the plugin is the only honest
source and brief 9.2 has no key for it. A `LaunchAgent` is used rather than a
login item, so the widget returns after a restart without appearing in the user's
Login Items list.

**Creating a note closes the editor first.** Creating replaced the editor rather
than closing it, so an empty note never went through `stopEditing` and was never
discarded — pressing the shortcut twice left a blank card behind each time.

### Deviations from the brief

- Brief 6.12 asks for the dock side as a radio pair. Tauri 2.11 has no radio menu
  item, so two check items are driven as one: selecting either sets it and clears
  the other. It reads and behaves as a radio.
- The tray icon is the app icon as a template image, which renders as a solid
  silhouette in the menu bar. A real monochrome icon is M5's icon work.
- Live application of the open/close delays and panel width is not wired; only the
  dock side and tab offset are (brief M3 asks for "live dock side switching", and
  the settings view that would expose the rest is M4).

### Known gap: the panel gets no keystrokes until it is clicked once

**Still unfixed after a second, longer attempt on 13 Sep 2026.** The shortcut and
the tray open the panel and put a new note in the editor, verified on screen —
but nothing typed reaches it until the panel is clicked once.

The decisive measurement: after the shortcut, `Cmd+F` does not open the search
field either. **No key reaches the webview at all**, so this is not the editor
losing DOM focus — the panel does not own the keyboard. After any click it does,
and both typing and `Cmd+F` work normally.

Ruled out, each tried and measured against a real keystroke:

| Attempt | Result |
|---|---|
| `panel.show_and_make_key()` alone | window reports focused, no keys |
| plus `window.set_focus()` | returns `Ok`, no keys |
| plus `NSApplication::activate()` | no keys |
| `activateIgnoringOtherApps(true)` | no keys |
| dropping the `nonactivating` style mask for the call | no keys |
| the same, without restoring the mask afterwards | no keys |
| `ActivationPolicy::Regular` before activating | no keys |
| `can_become_main_window: true` | no keys, and the focus bounce became instant |
| re-focusing the textarea on the window `focus` event | no keys by itself — but see the mitigation |

None of them are carried in the code: `focus_panel` is back to
`show_and_make_key()` alone, because keeping incantations that were measured to do
nothing would be worse than the gap itself.

**Mitigation that is kept.** `NoteEditor` re-focuses its textarea when the window
gains focus, so *one click anywhere in the panel* — not necessarily inside the
textarea — puts the caret in the note and typing lands. Verified.

**The lead worth trying next.** `show_and_make_key` sets the panel's *content
view* as first responder. The content view is not the `WKWebView`; a click sets
the responder to the web view itself, which is the one difference between the path
that works and the paths that do not. Reaching it means walking the view hierarchy
from `window.ns_window()` with `objc2` and calling `makeFirstResponder:` on the
web view.

### M3 acceptance checklist

Verified on screen unless marked otherwise.

- [x] The tray icon appears in the menu bar, with the menu of brief 6.12 in
      sentence case: Open notes, New note, Dock on left / Dock on right,
      Launch at login, Quit Edge Notes
- [x] The dock-side pair behaves as a radio and shows the current side
- [x] "Dock on left" moves the tab and panel to the left edge immediately, fully
      mirrored, with no restart, and the choice persists
- [x] "Dock on right" moves it back
- [x] "New note" opens the panel with an empty note in the editor
- [x] "Launch at login" creates `~/Library/LaunchAgents/Edge Notes.plist`, and
      clearing it removes the file
- [x] The global shortcut opens the panel with a new note in the editor
- [x] The panel stays open after the shortcut rather than closing itself
- [x] A second launch does not start a second app: it shows the running panel,
      and the running app survives (it used to abort)
- [x] Logs are written to `~/Library/Logs/dev.edgenotes.app/Edge Notes.log`
- [ ] Typing straight after the shortcut, without clicking first — the known gap
- [x] One click anywhere in the panel after the shortcut puts the caret in the note
- [ ] "Quit Edge Notes" (not exercised, to keep the app running for the rest)
- [ ] Anything on Windows or Linux, including the Wayland fallback

## M4: polish (in progress)

### Done and verified on the running app

**The settings view** (brief M4), reached from a gear in the header: theme, open
and close delays, panel width, monitor and the new-note shortcut. Everything
applies immediately (brief 9.3) — switching to Light repainted the panel and tab
while the system stayed dark, and a typed width of 360 resized the real window.

**Export** writes one Markdown file per note plus `notes.json` into
`~/Documents/Edge Notes <date time>/`, and the panel reports the path.

### Decisions

**Numeric settings clamp when you finish, not while you type.** Clamping on every
keystroke made multi-digit values impossible: typing 400 into a 280–420 field went
4 → 280, then "2800" → 420. The draft is local until blur or Enter. The shortcut
field works the same way, because rebinding per keystroke tried to register "C",
"Cm", "Cmd" and logged a failure for each.

**`Placement` groups the settings that decide where the dock sits** (side, offset,
width, monitor), so the next placement setting does not touch every call site.

**Export goes to the documents folder rather than asking.** A save dialog would
mean `tauri-plugin-dialog`, outside brief section 4. The first export makes macOS
ask the app for permission to that folder, which is expected.

**The editor grows into place** (brief 6.9), animating `max-height` from about a
card's height to its own over 160 ms and then releasing the constraint — it has to
be released, or the textarea could not grow as you type.

**The dark palette now lives behind two selectors** — the system preference unless
the user chose light, and an explicit dark choice. They must stay identical;
tokens.css says so at the top of the block.

### The contrast check found a real accessibility defect

Brief 7.3 asks for AA contrast on every note colour, so it is now a test rather
than an opinion — and it failed on ten of forty-two pairs. Card titles were fine;
**reduced-opacity text fell below AA in light mode**: the card preview at 0.75 on
yellow, peach and mint, and the edited-time line at 0.70 on *all seven* colours.

The lowest opacity that clears AA on every colour in both themes is 0.79, so there
is now a single `--note-secondary-opacity` token at 0.82, used by the card
preview, the untitled placeholder, the editor's placeholder and its edited-time
line. `src/lib/contrast.test.ts` fails if it is ever lowered past the threshold.

### Dragging the tab

Rust drives it, because the window moves with the tab: the frontend's own
coordinates shift under the pointer mid-drag, while the poller already has the
cursor in desktop coordinates. Pointer-down on the tab begins it; the release is
caught on the *window*, since the pointer leaves the tab as soon as the window
starts following it, and `pointercancel` ends it too so an interrupted drag cannot
leave the dock stuck. Dropping persists the position as a ratio (brief 8.5) and
hands the cursor back to hover, so the panel opens without moving the mouse again.

The offset is clamped as a ratio rather than in pixels, so the stored value always
matches where the tab is; clamping pixels alone would let the ratio drift past the
end, and dragging back would do nothing until the drift was used up.

**The drag test found a second bug:** `panel.width` resized the window but not the
panel. Rust sized the window from the setting while `--panel-width` stayed a
static 320 px token, so a widened window just grew a transparent margin.
`DockShell` now drives the variable from the setting.

### Measurements (release build, macOS 26.6.2, M-series, 1920×1080 at 1×)

| Target (brief 11) | Measured |
|---|---|
| Visible tab in under 1 second from launch | **147 ms**, by polling the screen at ~40 ms granularity |
| Idle CPU near 0% | **0.05%** mean over 30 s, collapsed and untouched |
| Installer under about 15 MB | **4.5 MB** bundle (the installer itself is M5) |
| Resident memory | 90 MB |

Also confirmed on the release bundle: **transparency survives bundling**, so
issue [#13415](https://github.com/tauri-apps/tauri/issues/13415) does not affect
this app — worth knowing before M5. The dragged tab position also survived the
dev-to-release restart, which exercises the ratio round-trip through SQLite.

Not measured: the 60 fps slide, which needs frame instrumentation rather than a
stopwatch, and the transparency GPU cost (issue #15471) — that one needs
`sudo powermetrics --samplers gpu_power -i 1000 -n 5` with the panel collapsed and
idle, so it needs the owner.

### Reduced motion and accessibility

- [x] Both transition sites — the group slide and the tab chevron — are covered by
      `prefers-reduced-motion` blocks, and the editor's new expansion checks it
      before animating.
- [x] Contrast verified and fixed, above.
- [x] `prefersReducedMotion` tolerates a missing `matchMedia` rather than
      throwing: an absent accessibility API must not take the editor down with it.

## M0 acceptance checklist

From brief section 12. Run `npm run tauri dev`, then work through these with
another app focused (a browser or editor) so the dock is genuinely inactive.

- [ ] Tab is visible at the right edge above other apps, with no taskbar or Dock icon
- [ ] Hovering while another app is focused opens the panel and does not steal focus
- [ ] Leaving closes the panel after the delay; re-entering during close reverses it
- [ ] Clicks outside the tab and panel reach the apps underneath
- [ ] The first click inside the panel works while another app is active (macOS)
- [ ] Typing into the test input works after clicking into the panel
- [ ] The panel appears over full-screen apps and on every Space (macOS)
- [ ] Placement is correct at 100%, 150% and 200% scaling and on a secondary monitor
- [ ] No flash or jump at startup, open, or close

Also worth checking while you are in there:

- [ ] Keep open (the pin) holds the panel open when the cursor leaves
- [ ] With Keep open off, focusing the test input holds the panel open too
- [ ] Release notes: the release `.app` still renders transparent (issue #13415)
