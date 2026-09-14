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
| M5 Packaging | macOS done: icons, metadata, .dmg built and installed. Windows and Linux packages cannot be built here. |

Work after M5, owner-requested, newest last:

| Feature | Date | Status |
|---|---|---|
| Audit pass and note pinning | 13 Sep 2026 | Built; committed 14 Sep 2026 (`7c7798c`). Checklist not yet run. |
| Tab appearance and open on click | 13 Sep 2026 | Built; committed 14 Sep 2026 (`7c7798c`). Checklist one item verified. |
| Lightweight formatting | 14 Sep 2026 | Built, and the click paths verified on the running app. |
| Lightweight formatting and expanded notes | 14 Sep 2026 | Committed as `8ff1fbe` and fast-forwarded into `master` (local only, no remote). |
| Click outside to leave the editor | 14 Sep 2026 | Built and tested in jsdom; not yet run on the app. Uncommitted. |
| Sixteen-colour palette | 14 Sep 2026 | Built; contrast tested for all 16 in both themes. Not yet run on the app. Uncommitted. |
| Lock icons for locked (pinned) notes | 14 Sep 2026 | Built. Uncommitted. |
| Floating pill tab | 14 Sep 2026 | Built; the collapsed pill seen on screen. **The owner may ask to reset it** — see its section. |
| Tasks tab, task details, reminders, translucency, card elevation | 14 Sep 2026 | Released in **v0.0.2**. |

**Releases:** [v0.0.1](https://github.com/prasenjithiwale/edge-notes/releases/tag/v0.0.1)
and [v0.0.2](https://github.com/prasenjithiwale/edge-notes/releases/tag/v0.0.2),
both published 14 Sep 2026 for macOS (universal), Windows (x64) and Linux
(x86_64). v0.0.2's Linux and Windows builds passed lint and both test suites on
those systems before bundling; its macOS `.dmg` was verified universal, at
version 0.0.2, and byte-identical after upload. None of the released builds has
been installed and run yet.

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

## Session of 14 Sep 2026: resumed after a power loss

The machine shut down during the previous session. Nothing was lost or half
written: the tree held the audit pass, pinning, and the tab appearance and
open-on-click settings, all complete and uncommitted, and the full gate passed as
found (lint, `tsc`, 153 frontend tests, `cargo fmt`, clippy, 102 Rust tests). The
session had stopped after recording both passes and before running either
checklist. The work was committed as `7c7798c` at the owner's request, and the
session moved on to the two features below.

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
3. **Linux placement fix is unverified on real hardware** (14 Sep 2026). See
   "The tab moved inwards on Kubuntu" below: diagnosed from the GTK source, not
   reproduced — there is no Linux machine here.
4. **The tab may not float over full-screen apps.** Seen by accident on
   13 Sep 2026: with a video full-screen, a screenshot showed no tab at the edge,
   though the app was running. Brief 8.8 expects `full_screen_auxiliary` plus
   `can_join_all_spaces` to put it there, and this is an M0 checklist item that
   has never been run deliberately. Test it properly: open something full-screen,
   then look for the tab and hover it.
5. **CSS wiring and the slide animation handshake have no test.** A selector that
   matches nothing still looks identical to a passing build.
6. **Formatting keystrokes are unverified on the running app** (14 Sep 2026).
   `Cmd+B`, `Cmd+I`, `Cmd+Shift+X/7/8/9`, Enter continuing a list, and `Cmd+Z`
   undoing a toolbar change were tested in jsdom only. No keys were sent to the
   real app, because a key that misses the panel lands in the owner's editor —
   and Esc there interrupts the agent's own session. The toolbar, ticking, links
   and expansion *were* driven with real clicks. The undo claim rests on WebKit
   honouring `execCommand("insertText")`, which is the part most worth checking.

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

## M5: packaging

### Done

**Icons are generated, not hand-made.** `tools/make_icons.py` draws the app icon,
the Windows logo set, `icon.icns`, `icon.ico` and the menu-bar template, with its
own small PNG and ICO writers — the build machine has no image tooling of any
kind, and checked-in binaries with no source are a trap. The mark is what the app
looks like: a note panel with its tab and the three recent-colour dots of
brief 6.5. Regenerate with `python3 tools/make_icons.py`.

**The tray icon is a monochrome outline.** macOS uses only a template image's
alpha, so the coloured app icon rendered as a solid black blob in the menu bar.
The new one is drawn as an outline for that reason and verified on screen beside
the system's own icons.

**Bundle metadata**: publisher, category, copyright, short and long descriptions,
and macOS 12 as the minimum system version (brief 5). A custom
`src-tauri/Info.plist` sets `LSUIElement`, verified to *merge* with what Tauri
generates rather than replace it — Rust sets the activation policy too, but that
runs after AppKit has already given the app a Dock icon, so without this the icon
flashes on every launch.

**The `.dmg` builds and installs.** `Edge Notes_0.1.0_aarch64.dmg`, 2.3 MB, with
the `.app` at 4.6 MB — comfortably inside brief 11's 15 MB. The packaged
`Info.plist` carries the right identifier, version, category, copyright and
minimum system version. The owner installed it to `/Applications` and it runs
there as an accessory app with the new tray icon.

**The README** covers running, building, the icon generator, signing and
notarising, the per-platform notes, where notes are stored, and the known
limitations.

### Not done, and why

- **Windows and Linux packages.** Tauri builds only for the platform it runs on,
  so the `.msi`, `.exe`, `.AppImage` and `.deb` need Windows and Linux machines or
  CI runners. The commands are identical and are in the README.
- **Signing and notarising** need an Apple Developer ID. The build here is
  ad-hoc signed, which runs locally but is stopped by Gatekeeper anywhere else.
  The steps and the environment variables are in the README, unexercised.
- **No CI.** Nothing runs the checks or builds the other platforms automatically.

## Audit pass and note pinning (13 Sep 2026)

A review of the codebase against the brief, including note pinning, which was
uncommitted in the tree and not yet recorded here. Checks only: nothing below has
been run against the real app yet.

### Note pinning (post-v1 feature, built early)

Brief 3 lists pinning as not in v1, while brief 9.1 reserves the `pinned`
column for it. It uses that column, so no migration was needed. Pinned notes sort
first, then by edit time, in both `db::notes::list` and `sortNotes`, which must
agree. A pinned card is not a button: its text is selectable, and the pencil is
the only way into the editor. The pencil also carries `data-card`, so arrow keys
and Enter still reach the note. Pinning does not bump `updated_at`, for the same
reason restore does not.

**Still open, for the owner to decide:** the pinned card's text uses
`user-select: text` and `cursor: text`. That is the feature's point, but brief 7.5
and CLAUDE.md allow both only in text fields. Pinning also uses the same pin icon
as Keep open in the header.

### Fixed

1. **The tab dots showed pinned notes, not the most recently edited ones.**
   `recentColors` used `sortNotes`, which now puts pinned notes first. Brief 6.5
   promises the three most recently *edited* notes, so the dots now sort by edit
   time alone.
2. **Pinning from the editor re-sorted the list while the editor was open.** That
   broke the rule that the list stays still until `stopEditing`. `setPinned` now
   re-sorts immediately only when no editor is open.
3. **The pin buttons used the accent colour.** Brief 7.1 reserves accent for
   focus rings and Keep open. Pinned state is now a filled pin in the note's own
   text colour, which also avoids an unchecked accent-on-note-colour contrast pair.
4. **`notes_set_pinned` had been inserted under `notes_delete`'s doc comment.**
5. **Quit dropped unsaved typing (brief 11: flush on quit).** The tray's Quit
   called `app.exit(0)` at once, and autosave is debounced 400 ms. Quit now emits
   `app:quit-requested`. The frontend runs `flushAll`, which closes the editor
   (discarding an empty note) and writes every pending autosave, then calls
   `app_quit`. Rust exits anyway after 1.5 s, so a hung webview cannot make Quit
   do nothing. This adds one event and one command beyond brief 9.3 and 9.4.
6. **The context menu was never disabled (brief 7.5).** It is now suppressed in
   production builds, except in text fields and over selected text. That second
   case is a deviation: it is how pinned text gets copied.
7. **`Panel` left `listen()` rejections unhandled.** Vitest reported two
   unhandled errors on every run while the tests still passed, which would hide
   a real one. The rejection is now caught and logged, as `DockShell` already did.

### Checklist for this pass

- [ ] Pin a note from the editor footer: the editor stays put, and the note moves
      to the top on Done
- [ ] Unpin from the card: it drops back into edit-time order at once
- [ ] The pin buttons are the note's text colour, filled when pinned, never blue
- [ ] With a pinned old note, the tab dots still show the three most recently
      edited notes
- [ ] Pinned card text can be selected and copied; the pencil opens the editor
- [ ] Type into a note and choose Quit from the tray immediately: the text is there
      after relaunch
- [ ] Quit with an empty new note open: no blank card after relaunch
- [ ] ~~Release build: right-click on chrome shows no menu; right-click in the editor,
      the search field, and over selected pinned text still does~~ — superseded
      on 14 Sep 2026: right click is disabled everywhere

## Tab appearance and open on click (13 Sep 2026)

Two settings the owner asked for, neither in brief 9.2. Checks only so far:
nothing below has been run against the real app yet.

| Key | Values | Default |
|---|---|---|
| `tab.appearance` | `"translucent"`, `"solid"` | `"translucent"` |
| `dock.openOn` | `"hover"`, `"click"` | `"hover"` |

Both are in the settings view as segmented controls ("Tab" and "Open panel") and
apply immediately.

### Decisions

**The tab is translucent only while collapsed.** It fades to
`--tab-translucent-opacity` (0.6) while waiting at the edge, and turns solid as
the panel slides out. A see-through tab attached to a solid panel looks broken.
The whole tab fades, border and dots included, because a translucent fill alone
leaves an opaque outline that reads as a frame. This departs from brief 7.1's
flat, solid surfaces at the owner's request. It uses `opacity` rather than
`color-mix()`, which the WebKit in macOS 12 (brief 5) does not support.

**A click is a tab press that never became a drag.** The tab already sends
`dock_begin_tab_drag` and `dock_end_tab_drag` on pointer down and up, and Rust
drives the drag from the polled cursor. So the controller decides: a press that
never travels past `DRAG_THRESHOLD_LOGICAL` (4 px) is a click. There is no
separate click event from the frontend to race against the drag. This changes
`dock/controller.rs`, which the project rules put off-limits by default; the
dock tests were extended from 47 to 60 and run.

**Two drag bugs fixed along the way, since click mode would have hit them on
every click.** The first cursor sample of a press used to snap the tab's centre
to the pointer, so grabbing the tab near one end jumped it by up to 44 px. The
tab now keeps its distance from the cursor, and does not move at all below the
threshold. `dock_end_tab_drag` also wrote `dock.tabOffset` on every release,
moved or not; it now writes only when the tab actually moved.

**Click mode changes only how the panel opens.** Clicking the tab toggles it,
and closing that way is an explicit dismissal, like Esc, so a cursor resting on
the panel does not reverse it. A click-opened panel auto-closes on leave exactly
like a hovered one (brief 6.3). It is not treated as a shortcut open, so it adds
no `Focus` action beyond what the click itself does (brief 8.6). The shortcut and
the tray are unchanged. The open delay field is disabled in click mode, where it
does nothing.

### Checklist

- [x] On a fresh install the collapsed tab is visibly see-through over a busy
      window, with the chevron and dots still easy to find — seen on 14 Sep 2026
      over a dark editor
- [ ] The tab turns solid as the panel slides out, and see-through again as it
      slides away, with no flicker at either end
- [ ] Settings → Tab → Solid makes the collapsed tab opaque immediately, and
      survives a relaunch
- [ ] Settings → Open panel → On click: resting on the tab does nothing, and the
      open delay field is greyed out
- [ ] In click mode, one click on the tab opens the panel while another app is
      focused, and that app keeps focus
- [ ] Clicking the tab again closes it, with the cursor still on the tab
- [ ] In click mode, moving the cursor off the panel still closes it after the
      close delay
- [ ] Dragging the tab still moves it in both modes, never opens the panel in
      click mode, and the tab does not jump when grabbed near its top or bottom
- [ ] A click without dragging does not nudge the tab
- [ ] Switching back to On hover restores hover opening immediately

## Lightweight formatting (14 Sep 2026)

Bold, italic, strikethrough, bulleted and numbered lists, checklists and links,
asked for by the owner. Brief 3 lists formatting as not in v1; brief 14.3 is the
shape used here — **stored as plain text**. The owner chose Markdown markers from
three options (markers, hand-built live formatting, an editor library), so no
dependency was added and the database, export and search are unchanged.

### What it does

- **Editor:** a toolbar above the textarea (bold, italic, strikethrough; bulleted,
  numbered, checklist) with shortcuts `Cmd+B`, `Cmd+I`, `Cmd+Shift+X`, and
  `Cmd+Shift+8/7/9` (`Ctrl` elsewhere), shown in each tooltip. The editor shows the
  markers. Enter in a list item starts the next one (same bullet, next number, an
  unticked box); Enter on an empty item ends the list; Shift+Enter is always a plain
  break.
- **Cards** render the formatting: bold is weight 600, links are underlined in the
  note's own text colour, list items get their own rows, and **checkboxes can be
  ticked straight from the card** without opening it.
- **Links** (bare `http`/`https` URLs) open in the default browser.

### Decisions

**Toggles, not one-way buttons.** Bold on a bold selection unwraps it; a list
button on lines that are already that list removes the prefix. Wrapping skips
surrounding whitespace and each line's list prefix, because a marker never spans
lines and `**- [ ] milk**` would stop being a task.

**Edits go through `execCommand("insertText")` so `Cmd+Z` undoes them.** Setting
the textarea's `value` wipes the undo stack. The API is deprecated but implemented
by all three webviews; where it is missing (jsdom) the edit falls back to
`setRangeText` plus an `input` event. That is one of two deliberate lint
suppressions; the other is `keyCode === 229`, the only way to tell Safari's
IME-committing Enter from a real one.

**Formatting keys live in `Panel`'s window listener**, with the Esc cascade,
because components handle no keys (M2). They act only when the event target is the
note textarea, marked `data-note-editor`.

**A card is no longer one `<button>`.** A checkbox or link inside a button is
invalid and unclickable. An unpinned card is now a `div` that opens on click, with a
transparent covering button that carries the focus ring, `data-card`, and an
accessible name made from the title with the markers stripped. The card's text
passes clicks through; its checkboxes and links do not.

**A tick is an edit.** It goes through `setContent`: debounced, flushed on quit,
bumps `updated_at`, and — like typing — does not re-sort the list under the cursor.

**The parser is a deliberate subset, not CommonMark**, in `src/lib/markdown.ts`:
`**bold**`, `_italic_` or `*italic*`, `~~strike~~`, bare links, and `-`/`*`/`+`,
`1.`/`1)` and `- [ ]` items. `snake_case_words` are not italicised, sentence
punctuation stays outside a link, and a line of unmatched markers parses in linear
time (tested).

**Links open through a new `open_url` command, not the webview.** Following a link
would navigate the widget itself away, and the webview has no opener permission
(brief 9.5). `src-tauri/src/links.rs` accepts only `http`/`https` links with a
host, no whitespace, quotes or control characters, and at most 2 048 bytes, then
passes the URL to `open` / `xdg-open` / `rundll32` as a single process argument,
never through a shell. No dependency: `tauri-plugin-opener` is outside brief 4.

### Deviations from the brief

- Formatting itself is post-v1 (brief 3), built at the owner's request.
- **A checklist card shows up to five rows plus "N more"**, against brief 6.8's
  two-line preview. Two rows would rarely be the items worth ticking. Plain
  paragraphs still flow into the two-line clamp exactly as before; other lists
  show two rows.
- `open_url` is a command beyond brief 9.3.
- `noteTitle` and `notePreview` were replaced by `cardPreview`, not kept beside it.

### Verified on the running app (clicks only, see open gap 5)

- [x] A card renders italic and struck-through title text, checkbox rows with bold
      text, a ticked item struck through, a numbered item, an underlined link, and
      a clipped paragraph
- [x] Ticking a box on the card writes `- [x]` to SQLite, leaves the editor closed,
      and the card keeps its place
- [x] The toolbar's bulleted-list button prefixes the caret's line, keeps the caret
      and keeps focus in the textarea
- [x] A link opens in the default browser (Arc) and the widget does not navigate

### Checklist

- [ ] Select a word and press `Cmd+B`: it gains `**` and stays selected; again removes them
- [ ] `Cmd+I` and `Cmd+Shift+X` do the same with `_` and `~~`
- [ ] `Cmd+Z` right after a toolbar change undoes just that change
- [ ] `Cmd+Shift+8`, `7` and `9` make bullet, numbered and checklist lines; again removes them
- [ ] Enter at the end of `- milk` gives `- `; Enter again ends the list
- [ ] Enter after `3. rice` gives `4. `; after `- [x] done` gives `- [ ] `
- [ ] Shift+Enter in a list item is a plain line break
- [ ] Typing Japanese or Chinese with an input method: Enter commits the text and
      does not start a list item
- [ ] Text on every note colour, links and ticked items included, is readable in
      light and dark
- [ ] `snake_case_names` and `2 * 3 * 4` show literally on the card

## Expanded notes (14 Sep 2026)

An expand icon on every card, and in the editor, grows the panel so a long note can
be read or edited comfortably. The owner asked for it without further questions,
so the design choices below are the agent's.

### What it does

- **The panel itself grows.** At most 760 logical px wide or 60% of the work-area
  width, whichever is narrower (never narrower than the normal panel), and 90% of
  the work-area height. It stays docked to the same edge with the tab on its inner
  side, so hover, auto-close and dragging all work unchanged.
- **An unpinned note opens in a full-height editor** with the toolbar, at 14 px.
- **A pinned note opens in a formatted reading view** with an Edit button,
  matching the pinned card's "read, don't edit by accident". Done in the large
  editor also lands in the reading view. Boxes can be ticked and links followed
  there too.
- The header keeps Keep open and New note. Search and Settings are hidden, because
  both need the list.
- **Leaving:** the shrink icon; Esc (the editor first, then the large view, then
  search, then the panel); search (`Cmd+F`); deleting the note; or the panel
  collapsing, after which the next open is always the normal panel. A new note
  made while expanded opens expanded.

### Decisions

**Grow the dock panel rather than open a second window.** Brief 3 rules out
multiple windows for v1, and a second webview would need its own store kept in
sync with the first. Growing the one window keeps a single store and reuses every
docking rule, because hit testing already follows `panel_rect`.

**Rust owns the size, as it owns every window size.** `DockGeometry` gained a
`large` flag and `Input::SetLarge`; `dock:state` now carries `panelWidth` and
`large`, and `DockShell` paints `--panel-width` from it instead of from the
`panel.width` setting, because the large width depends on the monitor. The frontend
draws the large layout only once Rust confirms `large`, so a note meant for reading
is never squeezed into 320 px. `set_geometry` keeps the flag, so a settings or
monitor change does not snap an expanded note back, and `finish_close` clears it.

**The request to Rust is derived from state.** `Panel` sends `dock_set_large`
from an effect keyed on whether `expandedId` is set, rather than from each click
handler. Every way of ending an expansion then returns the panel to normal without
remembering to — the lesson of the `SearchField` lock in M2.

**An expanded note holds the panel open** through a counted `"expanded"` lock
owner, since reading happens with the cursor anywhere. Blur still clears the lock,
as for every owner.

**Found on the running app: shrinking closed the panel.** The shrink button sits
in the large panel's top corner, which is outside the normal panel, so from the
reading view the cursor was "outside" the instant the panel shrank and it closed
400 ms later. The controller now holds the close for `SHRINK_GRACE` (2 s) after
shrinking, or until the cursor enters, then applies the normal delay. Verified
after the fix: from the reading view, Shrink leaves the panel open with the cursor
still outside.

**The caret survives expanding.** Expanding swaps one editor for another; the
outgoing editor records its selection, and an editor for the same note mounting
within a second restores it.

**These changes touch `dock/`**, which the project rules put off-limits by
default: the panel size is geometry and the close hold is controller logic, and
neither can live anywhere else without breaking the pure-controller split. The dock
tests went from 60 to 70 (large-panel sizing at 1× and 2×, a narrow screen,
rebuilds keeping the flag, growing and shrinking in place, hit testing against the
large rect, collapsed refusal, reset on close, the shrink hold) and were run with
the full suite.

### Deviations from the brief

- `dock_set_large` is a command beyond brief 9.3, and `dock:state` carries two
  fields beyond brief 9.4.
- Brief 6.4 fixes the panel at 280–420 px; the large panel is outside that range
  on purpose, and only while a note is expanded.
- Brief 6.11's Esc cascade gains a step, between the editor and search.
- The switch between sizes is a snap, not an animation.

### Verified on the running app

- [x] A card's expand icon grows the panel to about 760 × 950 px against the right
      edge, with the note in a full-height editor and the formatting toolbar
- [x] The header shows only Keep open and New note while expanded
- [x] Done in the large editor shows the formatted reading view, with Edit and
      Shrink, wrapped lines, tickable boxes and a working link
- [x] Shrink from the editor returns to the normal panel with the editor still open
- [x] Shrink from the reading view leaves the panel open (after the fix above)
- [x] After collapsing, the tab returns and the next open is the normal panel

### Checklist

- [ ] Expand a pinned card: the reading view, not the editor; Edit switches to the editor
- [ ] Esc in the large editor shows the reading view; Esc again shrinks; a third
      Esc collapses (keyboard — see open gap 5)
- [ ] Expanded with the cursor far away: the panel stays out; switching to another
      app with the cursor outside still closes it
- [ ] `Cmd+F` while expanded returns to the list with the search field open
- [ ] Delete the note from the large editor: the panel returns to normal and Undo
      puts the note back
- [ ] `Cmd+N` while expanded opens the new note expanded
- [ ] Dock on left: the large panel grows rightwards from the left edge, mirrored
- [ ] Drag the tab to near the top or bottom, then expand: the panel stays inside
      the work area and the tab stays attached
- [ ] Change the panel width in Settings, then expand and shrink: the normal width
      is the new one
- [ ] 150% and 200% scaling, and a secondary monitor

## Click outside, colours, lock icons and the floating tab (14 Sep 2026)

Four owner requests, taken after `8ff1fbe` was merged into `master`. The owner
chose the click-outside rule and the palette approach from options; the icon and
tab interpretations below are the agent's.

### Click outside the note leaves the editor — if nothing was typed

A click that starts and ends outside the editor closes it **only when the note's
text is what it was when the editor opened**. Once something has been typed, a
stray click keeps the editor open; Done and Esc still close it. Typing is
autosaved either way, so this is about not interrupting, not about saving.

- The store records the text at `startEditing`, `createNote` and `expand` into
  the editor (`editBaseline`, module state like `savedContent`), and
  `leaveEditorIfUnchanged` compares against it. Typing something and deleting it
  again counts as unchanged.
- Only the text counts. Changing the colour or the lock is not "typing", so a
  click outside after recolouring still leaves.
- The listener is the editor's own, on `window` in the capture phase, so it runs
  before whatever was clicked: clicking another card closes the unchanged editor
  and then opens that card cleanly. It is judged by where the press **started**,
  so a text selection dragged out of the textarea is not a click outside.
- An empty new note left by clicking outside is discarded, exactly as Done would.
- "Outside" means anywhere in the widget: other cards, the header, the filter
  row, the tab. A click in another app never reaches the webview and changes
  nothing.

### A sixteen-colour palette

Brief 7.3's seven colours grew to sixteen, ordered around the hue wheel: red,
peach, orange, yellow, lime, green, mint, teal, sky, blue, indigo, lavender,
purple, pink, sand, gray. Nine are new; the original seven keep their exact
values and ids, so existing notes are untouched and no migration was needed.
Only the palette id is still stored.

- **Editor:** a row of quick swatches — the note's colour, the colours of the most
  recently edited notes, topped up from the original seven — then a palette
  button that opens a grid of all sixteen, eight to a row. The quick row is chosen
  when the editor opens, so picking a colour does not reshuffle it under the
  cursor; a colour picked from the grid joins the row.
- **Rust** validates all sixteen through `NoteColor::ALL`.
- **Contrast:** every new colour was designed as a light and dark background/text
  pair and **passes AA in both themes**, for titles and for reduced-emphasis text
  at `--note-secondary-opacity` (96 checks). `contrast.test.ts` now reads the
  palette straight from `tokens.css` instead of a copy, and also fails if a
  palette id lacks tokens or the two dark blocks disagree. That needed
  `test.css.include` for `tokens.css` in `vite.config.ts`: Vitest otherwise
  blanks CSS, `?raw` imports included.
- **The filter row wraps.** Sixteen dots do not fit one row at 320 px, so the row
  grows instead of clipping, and is still 32 px with one row.

### Lock icons for locked notes

The note-pinning buttons on cards and in the editor footer now show a lock
(locked) and an open lock (unlocked), labelled "Lock note" / "Unlock note". A
pinned note already sorts first and opens read-only until Edit, which is what a
lock says; it also stops the feature sharing the pin icon with Keep open, which
was flagged as an open question on 13 Sep 2026. **Keep open in the header keeps its
pin.** Code, IPC and the database still call it `pinned`.

### The tab is a small floating pill

The owner found the tab too big and asked for something small, tablet-shaped and
floating.

- The tab's window and hit area shrank from 28×88 to **22×72** logical px
  (`Metrics::default()` in `dock/geometry.rs`, and `--tab-width`/`--tab-height`).
- Inside it, only a **12×52 pill** is painted: fully rounded, 4 px off the docked
  edge, with a soft shadow (`--shadow-tab`, light and dark). The rest of the box
  is transparent room for that shadow and the gap, and **still counts as the
  tab**, so a cursor thrown against the screen edge lands on it.
- The chevron is 10 px and the dots 4 px, to fit a 12 px pill. While open, the
  same 4 px gap separates the pill from the panel.
- Translucency (`tab.appearance`) fades the pill, as it faded the tab.

This changes `dock/geometry.rs`, because Rust owns the window size. Only the
default numbers changed, no logic; the dock tests that assert tab sizes were
updated, and all 70 pass.

**Reset to default, if the owner asks.** The previous tab was 28×88, flush against
the edge, rounded only on the side facing the screen centre (`--radius-control`),
with a 1 px border, no shadow, a 16 px chevron and 6 px dots. Restoring it means
putting back `tab_width: 28.0, tab_height: 88.0` in `Metrics::default()`,
`--tab-width: 28px; --tab-height: 88px`, and `Tab.module.css` and `Tab.tsx` as they
are in `8ff1fbe`, then the dock tests' 28/88 assertions.

### Deviations from the brief

- Brief 7.3 has seven note colours; there are now sixteen.
- Brief 6.5's tab was flush and rounded on one side, and brief 7.1 gives only the
  panel a shadow; the pill is floating, fully rounded and shadowed.
- Brief 7.1's 16 px icons: the tab chevron is 10 px.
- Brief 6.4's 32 px filter row can wrap to two rows.

### Verified

- [x] The collapsed pill on screen: small, rounded, off the edge, translucent,
      chevron and dots visible
- [x] Every new colour meets AA in both themes (test)
- [x] Frontend 285 tests, lint and `tsc`; Rust 119 tests, clippy and fmt

### Checklist

- [ ] Open a note, type nothing, click the header or another card: the editor
      closes (and the other card opens)
- [ ] Open a note, type a word, click outside: the editor stays open; Done closes it
- [ ] New note, type nothing, click outside: no blank card is left
- [ ] Select text in the editor and release the mouse outside it: the editor stays
- [ ] More colours opens sixteen swatches; picking one recolours the note and card,
      closes the grid, and adds it to the quick row
- [ ] The nine new colours look right and read well on cards in light and dark
- [ ] With many colours in use, the filter row wraps cleanly
- [ ] Lock icon on a locked card and in the editor footer; Keep open still a pin
- [ ] Hovering the pill, and the screen edge beside it, opens the panel
- [ ] The pill sits beside the open panel with a small gap, and does not jump
      when the panel opens or closes
- [ ] Dragging the pill along the edge still works
- [ ] Dock on left: the pill mirrors to the left edge
- [ ] Dark mode: the pill's shadow and border are visible

## Right click disabled (14 Sep 2026)

At the owner's request, the browser context menu is now suppressed **everywhere
and in every build**: chrome, cards, the editor, the search field and selected
text alike. Brief 7.5, and the 13 Sep 2026 audit pass, kept it in text fields and
over selected text and suppressed it only in production. Cut, copy and paste stay
on the keyboard; dev tools open with `Cmd+Opt+I` in a debug build. Locked note text
can still be selected and copied with `Cmd+C`.

- [ ] Right-click on a card, the header, the editor and the search field: no menu
- [ ] Select text on a locked card and press `Cmd+C`: it copies

## Versioning and the first release, v0.0.1 (14 Sep 2026)

The code went to GitHub (`prasenjithiwale/edge-notes`, private) on 14 Sep 2026,
with `master` as the default branch. The owner then asked for versioning and a
first release, starting at **v0.0.1**, for macOS, and Linux if it could be built
from a Mac.

### Versioning

- **`package.json` is the one source of the version.** `tauri.conf.json` reads it
  (`"version": "../package.json"`, verified in the Tauri 2 config reference).
  Cargo needs its own copy, so `npm run version:set -- X.Y.Z`
  (`tools/set_version.mjs`, no dependencies) writes `package.json`,
  `package-lock.json` and `Cargo.toml`, and refreshes only this crate's entry in
  `Cargo.lock`.
- `src/lib/version.test.ts` fails if `Cargo.toml` disagrees, if `tauri.conf.json`
  stops pointing at `package.json`, or if `CHANGELOG.md` has no entry for the
  version.
- Releases are tagged `vX.Y.Z` and published on GitHub Releases; `CHANGELOG.md`
  lists each one. The README's "Releasing" section has the steps.
- The version went from the scaffold's placeholder 0.1.0 down to 0.0.1.

### Can Linux be built on a Mac? No — so CI builds it

Tauri bundles only for the platform it runs on, and the Linux build links against
WebKitGTK and other system libraries that do not exist on macOS. Docker on this
Apple Silicon Mac could build **arm64** Linux packages, but most Linux PCs are
x86_64, and building that under emulation is very slow and unreliable for the
AppImage tooling. So `.github/workflows/release.yml` builds Linux on GitHub's
`ubuntu-22.04` runner (the packages Tauri's own pipeline guide installs), for
every `v*` tag or by hand from the Actions tab. It checks that the tag matches
`package.json`, runs lint and both test suites, builds the `.deb` and `.AppImage`,
and attaches them to the release, starting a draft if the release does not exist
yet.

macOS is built locally as a **universal** `.dmg` (Apple Silicon and Intel), which
needed `rustup target add x86_64-apple-darwin`. **This machine has two Rust
installs**, Homebrew's (first on `PATH`, Apple Silicon only) and rustup's, both
1.90.0; the target goes into rustup's, so the universal build must run with
`~/.cargo/bin` first on `PATH` or the Intel half fails with "can't find crate for
`core`". Everyday builds are unaffected. It is ad-hoc signed, not notarised;
the release notes explain how to allow it past Gatekeeper.

GitHub Actions minutes on a private repository are metered; a Linux release run
is roughly 15 minutes of the monthly allowance. Building macOS in CI too would be
possible but macOS runners cost ten times as much, so it stays local.

### Windows added to v0.0.1 (14 Sep 2026)

The owner asked for Windows at the same version. Windows cannot be built on a Mac
either — Tauri's macOS-to-Windows cross-compile is experimental, needs `llvm`,
`nsis` and `cargo-xwin` installed here, and makes only the NSIS installer — so the
Release workflow gained a `windows` job on `windows-latest`. It builds an NSIS
`setup.exe` and a WiX `.msi` after lint and both test suites, and attaches them
to the release.

- It was run by hand for the **existing `v0.0.1` tag**, so the Windows installers
  are built from exactly the commit the macOS and Linux builds came from. The
  workflow file itself runs from `master`; each job checks out the tag.
- A small `prepare` job now creates the draft release when there is none, so the
  Linux and Windows jobs running side by side cannot each start one.
- `platforms` on a manual run picks linux, windows or both; a tag push builds both.
- Windows runners check out with CRLF by default, which the tests that read source
  files as text would trip on, so the job disables `autocrlf` first.
- Windows minutes on a private repository count double.
- Unsigned: SmartScreen warns on first run ("More info → Run anyway").

### Not done

- arm64 Linux: GitHub's arm runners are free only for public repositories.
- Signing and notarising, which need an Apple Developer ID.
- The Linux build has been compiled and bundled in CI but never run on a real
  Linux desktop.

## To-Do tab (14 Sep 2026)

The owner asked for Notes and To-Do tabs at the top of the panel, or a better
option. Three were offered — a tab gathering checklist items from all notes, a
separate to-do list stored apart from notes, or a To-Do filter chip with no tabs —
and the owner chose **the tab of all checklist items**, which was recommended.

### What it does

- **Tabs replace the panel title**: a neutral segmented control, "Notes" and
  "To-Do", with the count of open tasks on To-Do.
- **To-Do lists every `- [ ]` item from every note**, grouped under the note's
  title and colour dot, groups in the list's order (locked first, then recent).
  There is no task table: a task is a line in a note, so it stays searchable,
  exportable and colour-coded, and needed no migration or Rust change.
- **Ticking** edits the note through `toggleTask`, like ticking on a card.
- **"Add a task"** appends `- [ ] text` to the note titled To-Do (any case,
  formatting ignored), or creates that note in the last-used colour with the task
  as its first item. Saved at once, not on the debounce. The note is found by
  title rather than a stored id so it is visible and under the user's control:
  rename it and the next task starts a new one.
- **Pressing a group's name** opens that note in the Notes tab's editor.
- **Done (n)** is collapsed by default and shows ticked tasks with their note's
  name; they can be unticked there.
- Empty states: "Nothing to do" with a hint, or "All done".

### Decisions

**The view holds still while in use.** A task ticked on the To-Do tab stays in
place, struck through, until the tab is left or the panel collapses, and groups
keep the order they had when the tab opened. Ticking edits a note and bumps its
`updated_at`, so without this the task would vanish into Done and its whole group
would jump to the top under the cursor. Groups that did not exist when the tab
opened (the To-Do note, the first time) go first, where the new task can be seen.

**Search and the colour filter stay on the Notes tab.** Both are about finding
notes; on the To-Do tab they are hidden, and `Cmd+F` switches to Notes and opens
search. `Cmd+N` makes a new note on the Notes tab as before.

**Switching to To-Do closes the editor properly** (`stopEditing`), so an empty
note is discarded and its lock released rather than left open, unseen, behind the
tab. It also ends an expanded note and any search.

**The add field holds the panel open while focused**, through a counted `"todo"`
lock owner, derived from state like the search field's.

**Esc on the To-Do tab clears a half-typed task first**, then collapses the panel.

### Deviations from the brief

- Brief 6.6 puts a "Notes" title on the left of the header; the tabs replace it.
- Brief 3 lists checklists as post-v1; they were built earlier today and this tab
  builds on them.

### Checklist

- [ ] The header shows Notes and To-Do, with the open-task count on To-Do
- [ ] To-Do groups every open checklist item under its note, with the note's colour
- [ ] Ticking a task there ticks it in the note; it stays struck through until you
      switch tabs or the panel closes, then appears under Done
- [ ] "Add a task" then Enter adds to the To-Do note, and creates it the first time
- [ ] Rename the To-Do note, add a task: a new To-Do note is created
- [ ] Pressing a group's name opens that note in the editor on the Notes tab
- [ ] The panel stays open while typing in "Add a task" with the cursor away
- [ ] Esc clears a half-typed task, then a second Esc closes the panel
- [ ] Cmd+F on the To-Do tab switches to Notes with search open
- [ ] Switching tabs while editing an empty new note leaves no blank card

## Sliding between Notes and To-Do (14 Sep 2026)

Requested by the owner. Switching tabs now slides:

- **The tab highlight** slides to the selected tab. The segments are equal width
  and both labels stay at weight 600, so nothing resizes mid-slide; the selected
  label is primary text, the other secondary.
- **The content slides** in tab order: To-Do comes in from the right, Notes from
  the left, over 180 ms with the panel's opening curve. Notes and To-Do sit side by
  side on a track twice the panel's width, translated by one pane.

### Decisions

**Both tabs stay mounted**, because a slide needs both on screen at once. The pane
off screen gets `inert` and `aria-hidden`, and becomes `visibility: hidden` once
the slide ends — which also covers WebKit before 15.5 (early macOS 12), where
`inert` is unsupported. That had knock-on effects, all handled:

- `TodoView` takes an `active` prop and starts a new visit each time it becomes
  active (group order taken afresh, tasks ticked last time settle into Done),
  instead of on mount. It blurs its field when hidden so it cannot hold the panel
  open from off screen.
- Arrow-key card navigation only runs on the Notes tab, and closing the editor by
  switching to To-Do does not try to return focus to a card that is off screen.
- The large expanded note and the settings view replace the track rather than
  sliding, as before.

**Reduced motion:** no slide (brief 6.2); the incoming tab fades in over 80 ms and
the highlight moves without animating.

### Checklist

- [ ] Clicking To-Do slides the content left and the highlight right; Notes slides
      back the other way, smoothly, with no flash or jump
- [ ] Mid-slide both views are visible side by side, and neither is clipped oddly
- [ ] After switching, Tab never lands on anything in the hidden view
- [ ] Reduce motion (System Settings → Accessibility → Display): switching fades
      quickly instead of sliding
- [ ] A long notes list keeps its scroll position after visiting To-Do and back

## Task details, reminders and panel translucency (14 Sep 2026)

The owner asked for tasks to have "time, priority, etc." They chose, from options:
**details stored inline in the task line** (recommended, over a separate task
store or a side table keyed by line), and **all four features** — due date and
time, priority, reminders, repeating tasks. Mid-build they also asked for a panel
translucency setting with a percentage slider.

### The task format

A task is still one checklist line; its details are tokens at the end, written
back in a fixed order:

    - [ ] Call the bank !high @2026-09-20 14:00 repeat:weekly

- `!high` / `!medium` / `!low`; `@YYYY-MM-DD` with an optional `HH:MM` (24-hour,
  local); `repeat:daily|weekly|monthly|yearly`.
- Read **only from the end of the line**, in any order, each kind once, so
  "email @john about !bugs" mid-sentence is never a token. A malformed date
  (`@2026-02-30`, `25:00`) stays part of the title.
- `src/lib/taskMeta.ts` holds the parser, the date maths and the labels, all pure
  and taking `now`. Months clamp (31 Jan + 1 month = end of Feb).

### What it does

- **To-Do tab:** sections Overdue, Today, Upcoming and No date (a task due earlier
  today at a set time is overdue once that time passes), then Done. Within a
  section: higher priority first, then sooner, a whole-day task before the timed
  ones of the same day, then note order as it was when the tab opened. Each task
  shows the note it comes from, which opens that note.
- **Details sheet:** a button on each task opens an inline sheet to rename it and
  set priority, date (with Today / Tomorrow / Clear), time and repeat. Every change
  is written straight into the line; the title commits on blur or Enter. **A task
  keeps its section while its sheet is open**, even if its new date belongs
  elsewhere — otherwise the sheet was torn down and rebuilt under the cursor and
  a date field lost focus, which the component test caught.
- **Cards and the reader** show a task's title and draw its details as chips: a
  flag (filled for high), the due label ("Today", "Tomorrow, 14:00", "Fri",
  "2 Oct", "5 Jan 2027", locale-formatted) and a repeat mark. Neutral colours —
  colour is for notes (brief 7.1) — with an overdue date carried by weight. The
  note editor keeps showing the raw tokens.
- **Repeating tasks:** ticking one, anywhere, moves its date to the next occurrence
  and leaves it open. A task left overdue catches up to today or later rather than
  stepping into the past; one with no date counts from today.

### Reminders

- **Rust owns the time, the frontend owns the format.** The frontend works out
  every reminder from the notes (`taskReminders`: at the due time, or 09:00 for a
  whole-day task, open tasks only) and sends the whole list with the new
  `reminders_set` command, one second after notes stop changing. A single thread
  in `src-tauri/src/reminders.rs` sleeps until the next one (waking at least every
  minute, for clock changes and sleep) and shows it through
  `tauri-plugin-notification`. The deciding logic (`due`, `next_at`) is pure and
  unit-tested.
- A reminder missed by up to 10 minutes (the Mac asleep, the app just launched)
  still shows; older ones only appear as overdue. What has been shown is
  remembered by id (note, title, due time), so a re-sent list never repeats one;
  changing a task's time makes a new reminder.
- **Setting:** `tasks.reminders`, on by default, applied live. Reminders passing
  while it is off are marked shown, so turning it on does not bring a burst.
- **Dependency:** `tauri-plugin-notification` **2.4.0** (the newest 2.x; a
  `3.0.0-alpha` exists and was avoided). It is outside brief section 4; the owner
  approved it by choosing reminders. Verified against the plugin docs and its
  source: sending from Rust needs no webview capability, and on macOS a debug
  build's notifications are attributed to **Terminal** while a bundled app uses
  its own identifier.
- **Verified on the running app:** a task due in the current minute produced the
  macOS notification permission prompt within seconds of the reload, which proves
  the path from note to `reminders_set` to the thread to the plugin. The prompt
  was left for the owner to answer, so the notification itself was not seen.

### Panel translucency

- `panel.translucency`, 0 % (solid, the default) to 60 %, stored in Rust and
  clamped there too. Past 60 % notes over a busy desktop stop being readable, since
  there is no blur behind the panel.
- The panel's background is `rgb(var(--surface-rgb) / var(--panel-alpha))`, with
  new `--surface-rgb` channel tokens in light and both dark blocks, because
  `color-mix()` is missing from macOS 12's WebKit. Note cards stay solid.
- **Settings:** a slider with the percentage beside it. Dragging previews every
  step directly on the root and stores only the released value, so a drag is one
  write; the keyboard commits each step.

### Deviations from the brief

- Brief 3 puts reminders post-v1, and brief 4 does not list the notification
  plugin (approved by the owner).
- Brief 7.1's solid surfaces: the panel can now be made translucent, off by
  default.
- The Done section on To-Do shows tasks as rows with their note, rather than
  grouped by note.

### Checklist

- [ ] Add "Pay rent !high @" plus tomorrow's date in the To-Do field: it appears
      under Upcoming with a filled flag and "Tomorrow"
- [ ] The details sheet sets priority, date, time and repeat; the task stays put
      until Done, then moves to its section
- [ ] Rename a task in the sheet: the note's line changes when the field is left
- [ ] A card shows chips, not tokens; the note editor still shows the tokens
- [ ] Tick a daily task: it moves to tomorrow and stays unticked
- [ ] A task due earlier today at a set time shows under Overdue, in bold
- [ ] Allow notifications, add a task due two minutes from now, and a notification
      arrives on time; it does not repeat after further edits
- [ ] Settings → Task reminders → Off: no notification for the next due task
- [ ] Settings → Panel translucency: dragging shows the percentage and fades the
      panel live; it persists after a relaunch; cards stay solid and readable
- [ ] Release build: the notification comes from Edge Notes, not Terminal
- [ ] Windows and Linux: notifications appear (untested)

## Card elevation, the Tasks tab, and a new details sheet (14 Sep 2026)

Three owner requests, after `669500d` was committed (not pushed).

### Cards have elevation

Note cards get a faint two-layer shadow (`--shadow-card`: a tight contact shadow
plus a soft spread), a little more under the pointer (`--shadow-card-hover`, an
enhancement only), and the open editor sits a step higher
(`--shadow-card-raised`). The reader view has the resting shadow. Dark mode uses
darker shadows plus a hairline ring, since a black shadow barely shows on a dark
surface. This departs from brief 6.8 ("no borders, no shadows") and brief 7.1
(only the panel has a shadow), at the owner's request; the shadows are kept faint
so the note colour stays the strongest thing on a card.

`color-scheme` is now set in the light and both dark token blocks, so native date
and time pickers and scrollbars follow the theme.

### To-Do is now Tasks

The tab, its panel and its count are labelled "Tasks". New tasks go to a note
titled **Tasks**, created the first time — but a note titled **To-Do** still
counts, so tasks added while the tab had its old name keep collecting in the same
note instead of a second one starting. Internally the view is still `"todo"`.

### The details sheet, redesigned

The first sheet was a sunken box of labels, native inputs and a select. It is now
a raised card of its own (surface colour, hairline, `--shadow-card-raised`,
fading in over 140 ms, none under reduced motion):

- The task's title at the top, large and borderless until hovered or edited.
- **Priority** as a four-way segmented control (None, Low, Medium, High) with a
  flag that gains weight with priority: faint for Low, outline for Medium, filled
  for High.
- **Due** as quick chips (Today, Tomorrow, Next week), then the date and time
  fields side by side with a round clear button.
- **Repeat** as chips (Never, Daily, Weekly, Monthly, Yearly) instead of a select.
- A footer with a one-line summary of what is set ("High priority · Tomorrow,
  14:00 · Repeats weekly") beside a Done button.
- Each section has a small icon and caption. Still neutral: the selected state is
  a filled chip with a darker outline, not the accent.

**Not yet seen on screen.** The component tests cover the behaviour, but the
look has not been checked in the running app — that needs the panel opened, which
means moving the owner's cursor.

### Checklist

- [ ] Note cards show a soft shadow in light and dark mode; hovering lifts one a
      little; the open editor sits higher than the cards around it
- [ ] Shadows are not clipped at the list's edges or under the filter row
- [ ] The tab reads "Tasks" with the open count
- [ ] With an existing "To-Do" note, "Add a task" still adds to it; with none, a
      "Tasks" note is created
- [ ] The details sheet: large title, priority segments with flags, Today /
      Tomorrow / Next week chips, date and time fields, repeat chips, summary line
- [ ] "Medium" and the flag fit their segment at the narrowest panel width (280 px)
- [ ] The date and time pickers are dark in dark mode

### Fixed: focus rings cut off at the top of a pane (14 Sep 2026)

Reported by the owner: clicking "Add a task" hid the top of its focus ring under
the header. The focus ring draws 4 px outside an element (2 px outline, 2 px
offset), and the Notes and Tasks panes clip at their edges for the slide, so the
first element in a pane lost its top edge. The add field and both scrolling lists
now have 4 px of top padding. That also stops the first note card's focus ring and
its new shadow being clipped at the top of the Notes list.

- [ ] Click "Add a task": the whole focus ring is visible
- [ ] Tab to the first note card: its ring and shadow are complete at the top

## The tab moved inwards on Kubuntu (14 Sep 2026)

**The first report from real Linux hardware**, on v0.0.2: Kubuntu (KDE Plasma,
which runs Wayland by default, so the app runs under XWayland per brief 8.10).
After the panel opened and closed, the tab sat inwards from the right screen edge
instead of at it, and the next open started from that position, half visible.

### Cause, from the GTK source

Tao applies `set_position` and `set_size` on Linux as `gtk_window_move` and
`gtk_window_resize`. In GTK 3.24 (`gtk/gtkwindow.c`) these behave differently on a
mapped window: **a move is sent to the window manager immediately**
(`gdk_window_move`), while **a resize is only queued** and sent on GTK's next
layout pass. So `poller::apply_rect`'s shrink order — resize, then move — reaches
the window manager as move, then resize.

For a right dock that means the still-wide expanded window is first moved so its
left edge is 22 px from the screen edge, i.e. almost entirely off screen. KWin
keeps windows on screen and pulls it back so its right edge meets the screen
edge; the resize then shrinks it to 22 px keeping its left edge — which is where
the open panel's left edge was. That is exactly the reported position. Growing is
unaffected, because its move-first order is the order that keeps the window on
screen, which fits "fine until the first close". A left dock never goes off
screen. macOS applies both calls in one run-loop turn, so it never showed.

Not ruled out: KWin adjusting the window for another reason. The fix below also
covers that, because it checks the result rather than trusting the order.

### Fix (Linux only, `dock/poller.rs`)

- **A shrink waits for the new size to land before moving**, so the window is
  never wide and past the screen edge at the same time.
- **Every placement is verified** against the geometry the window reports back
  (tao updates it from configure events), within a pixel (`geometry::rect_settled`),
  and applied again if the window manager put it elsewhere, up to three attempts.
- **A drift check** runs with the 2-second monitor refresh while collapsed and puts
  the tab back if it is not where the controller expects.
- A newer placement cancels an older one still settling (a generation counter),
  so fast open/close cannot drag the window back to a stale position.
- Corrections are logged as warnings (each drift position once), so a log from an
  affected machine confirms or refutes the diagnosis.

The settling code compiles on every platform, so clippy checks it here, but only
Linux calls it; macOS and Windows keep the original two-call path. The drift
check itself is Linux-only code, so its statement form was compiled separately.
One new geometry test (71 dock tests, 126 in all).

This changes `dock/`, which the project rules put off-limits by default: window
placement reaches Tauri only in `poller.rs`, so the fix could not live elsewhere.

### Checklist (Linux, ideally the Kubuntu machine that reported it)

- [ ] Open and close the panel ten times: the tab returns to the screen edge each
      time, and the panel always opens fully on screen
- [ ] At most a brief flicker of the tab at the end of a close
- [ ] The log (`~/.local/share/dev.edgenotes.app/logs/`) shows no repeated
      "could not place the window" warnings
- [ ] Dragging the tab along the edge still follows the cursor
- [ ] Dock on left behaves the same
- [ ] A plain X11 session, and GNOME, if available

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
