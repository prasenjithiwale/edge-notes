# Edge Notes: progress

Status, decisions and platform findings. Read before any task; update at the end
of every milestone. The spec is [build-brief.md](build-brief.md).

## Milestone status

| Milestone | Status |
|---|---|
| M0 Docking spike | Built, five follow-up fixes applied. **Never manually accepted** — see the note below. Windows and Linux untested. |
| M1 Notes core | Built; awaiting manual acceptance (checklist below). |
| M2 Find and organize | Built; awaiting manual acceptance (checklist below). |
| M3 System integration | Not started |
| M4 Polish | Not started |
| M5 Packaging | Not started |

Built and verified on macOS 26.6.2 (Tahoe), Apple Silicon, single 1920×1080
display at 1× scale. Every scaling and multi-monitor case is covered by unit
tests but has not been seen on real hardware.

**The M0 checklist was never reported as run.** M1 was started on the explicit
instruction to proceed, so the notes UI now sits on docking behaviour that no
human has watched. If a docking problem turns up later, that is where to look
first — the M0 checklist is still at the bottom of this file.

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

1. **Nothing has been visually verified.** Screen capture and the accessibility
   API are both blocked for the agent process on this machine, so the app was only
   confirmed to launch, convert to an NSPanel and run without errors. Every visual
   and interaction item in the checklist below is unverified.
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

### Still not covered by tests

The M1 note about CSS and component wiring now applies to considerably more code:
the Esc cascade, arrow-key movement, focus restoration and the lock counting are
all component behaviour, and Vitest runs in a `node` environment against pure
logic only. `moveCardFocus` and the store transitions have no test at all.

Closing that needs a DOM environment (`jsdom` or `happy-dom`) and probably
`@testing-library/react`, which are outside brief section 4 — **it needs your
approval before I add them.** The pure logic those components sit on
(`facetColors`, `recentColors`, `editedLabel`, `colorName`, `isExpandedPhase`) is
tested: 43 frontend tests, up from 29.

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
- [ ] The tab shows up to three dots in the colours of the three most recently edited notes
- [ ] Text on every note colour is readable in both light and dark mode, swatches included

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
