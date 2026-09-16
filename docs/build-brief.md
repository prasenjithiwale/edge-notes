# Ledge: build brief

> The app was called "Edge Notes" until 0.1.0, when it was renamed Ledge. This
> brief has been rewritten to use the new name; the progress log keeps the old
> one where it records what actually shipped.

## 1. What we're building

A lightweight desktop notes widget for macOS, Windows, and Linux, built with Tauri 2. It lives as a small tab docked to the left or right edge of the screen, floating above other apps. Hovering the tab slides out a panel of color-coded notes. Moving the cursor away slides it back in. It should feel like part of the OS: instant, quiet, and visually calm.

The approved mockups show three states:

1. **Collapsed.** Only a small tab (about 28×88 px) is visible at the screen edge, vertically centered, above all apps.
2. **Open.** A panel (about 320 px wide) slides out from that edge. It has a header (title, search, keep open, new note), a color filter row, and a list of colored note cards. The tab stays attached to the panel's inner edge.
3. **Editing.** Clicking a card expands it inline into an editor with a color picker, delete, and done. The whole widget can dock to the left edge instead of the right.

## 2. How to work on this (instructions for Claude)

- Build milestone by milestone (section 12). At the end of each milestone, stop, summarize what changed, and give me a manual test checklist before continuing.
- Milestone 0 is a de-risking spike. Don't build the notes UI until the docking behavior passes on macOS and Windows.
- Use only the dependencies listed in section 4. Ask before adding anything else.
- Verify Tauri APIs against the current Tauri 2 docs (https://v2.tauri.app) before using them. Code in this brief is a sketch, not copy-paste-ready.
- Keep modules small and pure. Window geometry and the dock state machine must be unit-testable without a running app.
- Treat the UI rules in section 7 as hard requirements.

## 3. Scope

### v1 goals

- Edge-docked tab, left or right, on one chosen monitor
- Hover to open, auto-close on leave, "keep open" toggle
- Create, edit, delete (with undo), search, and color-filter notes
- Seven-color palette per note; light and dark themes following the system
- Local-first persistence in SQLite
- Tray menu, launch at login, global shortcut, single instance

### Not in v1 (but design so they're easy to add)

- Cloud sync and accounts
- Rich text or markdown rendering, checklists, images
- Reminders, tags, folders, pinning notes to the top
- Multiple docks or multiple windows
- Mobile

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| App shell | Tauri 2 (latest stable 2.x) | Small binary, low idle memory, native window control |
| Frontend | React + TypeScript (strict) + Vite | |
| State | Zustand | |
| Styling | CSS Modules + one `tokens.css` of CSS variables | No UI kit, no Tailwind |
| Icons | `lucide-react` | 16 px, `strokeWidth={1.75}` |
| Font | System UI font stack | No bundled fonts |
| Database | SQLite via `rusqlite` (`bundled` feature), owned by Rust | Exposed only through typed commands |
| IDs | `uuid` crate, v7 | Time-ordered, sync-friendly |
| Rust utilities | `serde`, `serde_json`, `thiserror` | |
| Tauri plugins | `tauri-plugin-single-instance`, `tauri-plugin-autostart`, `tauri-plugin-global-shortcut`, `tauri-plugin-log` | Tray uses Tauri's built-in `tray-icon` feature |
| macOS only | `tauri-nspanel` (branch `v2.1`, pinned to a commit) | Converts the window to an NSPanel |
| Tests | `cargo test`; Vitest | |

Rust owns the database so the frontend never needs SQL, filesystem, or window permissions, commands stay typed, and a future sync engine can sit next to the data.

## 5. Platform support

| Capability | macOS | Windows | Linux (X11) | Linux (Wayland) |
|---|---|---|---|---|
| Docked tab and hover open | Yes | Yes | Yes | Via XWayland fallback (8.10) |
| Floats over full-screen apps | Yes, via NSPanel | Borderless full-screen yes; exclusive full-screen games no | Depends on window manager | Via XWayland, verify per desktop |
| Launch at login, tray, shortcut | Yes | Yes | Yes | Yes (tray depends on desktop) |

Minimum targets: macOS 12+, Windows 10 and 11 (WebView2), Linux distros with WebKitGTK 4.1 (Ubuntu 22.04+ or equivalent).

## 6. UX specification

### 6.1 Dock states

| State | Window | Enters when | Leaves when |
|---|---|---|---|
| `collapsed` | Tab only | App start; close finished | Cursor rests on tab for the open delay; shortcut; tray "Open notes" |
| `opening` | Expanded | Open triggered | Slide-in finished → `open`; cursor leaves early → `closing` |
| `open` | Expanded | Slide-in finished | Auto-close conditions met (6.3) → `closing` |
| `closing` | Expanded | Auto-close or Esc | Slide-out finished → `collapsed`; cursor re-enters → `opening` |

### 6.2 Timing defaults

- Open delay: 120 ms of the cursor resting on the tab. This hover intent avoids accidental opens when the cursor brushes the edge.
- Close delay: 400 ms after the cursor leaves the panel bounds (with 8 px tolerance).
- Open animation: 180 ms, `cubic-bezier(0.2, 0, 0, 1)`.
- Close animation: 140 ms, `cubic-bezier(0.4, 0, 1, 1)`.
- With `prefers-reduced-motion`: no slide, 80 ms opacity fade.

### 6.3 Auto-close rules

The panel does **not** auto-close while any of these is true:

- Keep open is on.
- A text field has focus (editing or searching).
- A menu, tooltip-triggered popover, or undo toast action is in use.
- It was opened by keyboard shortcut. Then it closes on Esc, or when another app takes focus.

When another app takes focus while the panel is open and Keep open is off, collapse after the close delay if the cursor is outside the panel.

### 6.4 Layout

Collapsed:

```
                                         screen edge ┐
                                               ┌─────┤
                                               │  ‹  │
                                               │  •  │
                                               │  •  │
                                               │  •  │
                                               └─────┤
```

Open (right dock):

```
                     ┌────────────────────────────────┤
                     │ Notes           ⌕   ⚲   [+]    │  header, 44 px
                     │ (All)  ●  ●  ●  ●  ●           │  filter row, 32 px
                ┌───┐│ ┌────────────────────────────┐ │
                │ › ││ │ Standup notes              │ │  note card
                │   ││ │ Deploy the fix before 4 pm │ │
                └───┘│ └────────────────────────────┘ │
                     │ ┌────────────────────────────┐ │
                     │ │ Groceries                  │ │
                     │ │ Milk, eggs, coffee, rice   │ │
                     │ └────────────────────────────┘ │
                     └────────────────────────────────┤
```

Dimensions (logical px):

- Tab: 28 × 88, attached to the panel's inner edge, slides with the panel.
- Panel width: 320 (later configurable, 280–420).
- Panel height: `min(640, 80% of work-area height)`, vertically centered on the tab and clamped inside the work area.
- The left dock mirrors everything horizontally.

### 6.5 Tab

- Neutral surface with a hairline border, rounded only on the side facing the screen center.
- Contains a chevron pointing toward the screen center, plus up to three small dots showing the colors of the three most recently edited notes.
- Chevron flips direction when the panel is open.

### 6.6 Header

- Title "Notes" on the left.
- Right side, in order: search icon button, Keep open toggle (pin icon, accent color when on), new note button (the only outlined button).
- Search replaces the title with a search field. Esc clears it and returns to the title.
- Every icon button has a tooltip and `aria-label` ("Search notes", "Keep open", "New note").

### 6.7 Color filter row

- An "All" chip, then one dot per palette color that has at least one note. Hide colors with no notes.
- Clicking a dot filters to that color; clicking it again, or "All", clears the filter.
- Selected dot: 2 px ring in `--text-primary` with a 2 px gap.

### 6.8 Note cards

- Background is the note color; text uses that color's paired text color.
- Title is the first non-empty line of the content: 13 px, weight 600, one line with ellipsis.
- Preview is the following lines: 12 px, weight 400, clamped to two lines.
- Padding 10 px 12 px, radius 10 px, 8 px gap between cards.
- No borders, no shadows, no timestamps on cards.
- Sort by most recently edited first.
- Click or Enter opens the inline editor. Keyboard focus ring is always visible.

### 6.9 Inline editor

- The card expands in place (height transition 160 ms) into an auto-growing textarea. After it reaches about 60% of the panel height, the textarea scrolls.
- Autosave with a 400 ms debounce, plus on blur and on close. No save button.
- Footer: seven color swatches, "Edited 2h ago" in tertiary text, delete icon button, and a "Done" text button.
- New note: inserted at the top, opened in the editor, using the last-used color. Empty notes are discarded when the editor closes.
- Delete: soft delete immediately, then show a toast "Note deleted" with an "Undo" button for 5 seconds.
- Esc closes the editor (saving). A second Esc collapses the panel.

**Important:** on macOS an inactive window may not receive hover events. Nothing essential can be hover-only. Hover styles are an enhancement.

### 6.10 Empty states

- No notes: headline "Capture your first note" and a "New note" button.
- No search results: "No notes match “{query}”".

### 6.11 Keyboard

- Global: `CmdOrCtrl+Alt+N` opens the panel with a new note in the editor. Avoid `Ctrl+Shift+N`, which browsers use for private windows.
- In the panel: `CmdOrCtrl+F` search, `CmdOrCtrl+N` new note, arrow keys move between cards, Enter opens a card, Esc closes the editor, then search, then the panel.

### 6.12 Tray menu

- Open notes
- New note
- Dock on left / Dock on right (radio)
- Launch at login (checkbox)
- Quit Ledge

## 7. Visual design system (hard requirements)

### 7.1 Principles

- Calm, quiet, native. The note colors are the only color; the chrome is neutral.
- One accent color, used only for focus rings and the active Keep open state.
- Flat surfaces. The panel gets a single soft shadow to separate it from what's underneath; cards and controls get none.
- 4 px spacing grid. Radii follow hierarchy: panel 14, cards 10, controls 8, chips fully rounded.
- Sentence case everywhere. No all-caps labels, no emoji, no decorative dividers or gradients.
- Two font weights only: 400 and 600.
- Nothing essential appears only on hover.
- When in doubt, remove it.

### 7.2 Chrome tokens

| Token | Light | Dark |
|---|---|---|
| `--surface` (panel, tab) | `#FFFFFF` | `#1C1C1E` |
| `--surface-sunken` (search field, chips) | `#F4F4F5` | `#2A2A2D` |
| `--border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` |
| `--text-primary` | `#1D1D1F` | `#F2F2F3` |
| `--text-secondary` | `#6E6E73` | `#A1A1A6` |
| `--text-tertiary` | `#8E8E93` | `#7C7C80` |
| `--accent` | `#2F6FEB` | `#5A8DF0` |
| `--shadow-panel` | `0 8px 28px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)` | `0 8px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)` |

Focus ring: `outline: 2px solid var(--accent); outline-offset: 2px;`

### 7.3 Note palette

| id | Light background | Light text | Dark background | Dark text |
|---|---|---|---|---|
| `yellow` | `#FDF3C4` | `#5C4A00` | `#4A3F16` | `#F7E9A8` |
| `peach` | `#FDE2D2` | `#6B3419` | `#4D2E1F` | `#F8CDB5` |
| `pink` | `#FADDE7` | `#6B2440` | `#4A2333` | `#F5C3D4` |
| `lavender` | `#E6E1FA` | `#3A2F73` | `#312A55` | `#D6CEF7` |
| `blue` | `#DCEBFA` | `#173F66` | `#1E3550` | `#BFD9F5` |
| `mint` | `#D9F2E6` | `#1B5238` | `#1D3F31` | `#BDE8D2` |
| `gray` | `#ECEBE8` | `#3A3936` | `#34332F` | `#E3E2DE` |

Store only the palette id in the database, never hex values, so the palette can be retuned later. Verify WCAG AA contrast for secondary text on every note color in both themes.

### 7.4 Typography

- `font-family: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Ubuntu, Cantarell, "Noto Sans", sans-serif;`
- Sizes: 11 (tertiary meta), 12 (previews, secondary), 13 (body, card titles, editor), 14 (panel title).
- Line height: 1.4 in chrome, 1.5 in the editor.
- `-webkit-font-smoothing: antialiased` on macOS.

### 7.5 Details that make it feel native

- `cursor: default` on buttons and cards, as native apps do. Text cursor only in text fields.
- `user-select: none` on chrome; text selection only inside the editor.
- Disable the browser context menu in production builds, except inside text fields.
- `overscroll-behavior: contain`; no rubber-band scrolling on the root.
- Thin scrollbars styled with the tokens, visible only while scrolling where the platform allows.
- No white flash at startup: the window starts hidden and is shown only after the frontend reports it has painted.

## 8. Window and docking architecture

### 8.1 Core approach

The window is always exactly the size of what's visible. Collapsed, the window is just the tab. Open, it's the panel plus the tab. Never use a full-screen transparent overlay with click-through: once a window ignores the mouse it can't detect hover either, and support for forwarding mouse movement is inconsistent across platforms.

### 8.2 Hover detection lives in Rust

On macOS an inactive window doesn't receive mouse enter, exit, or move events (see tauri-apps/tauri#11386). This widget is inactive almost all the time, because the user is working in another app. So DOM `mouseenter`/`mouseleave` can't be the source of truth.

Instead, a Rust `DockController` polls the global cursor position with `AppHandle::cursor_position()` and hit-tests it against the tab and panel rectangles.

- Adaptive polling: every 33 ms while the panel is open or the cursor is within 150 px of the docked edge; every 150 ms otherwise.
- One polling thread only. Never call `cursor_position()` or `available_monitors()` in tight or concurrent loops; there are reports of crashes under that kind of load (tauri-apps/tauri#15170).
- On Linux, also feed frontend `pointerleave` events into the controller as a secondary signal (see 8.10).

### 8.3 Module design

```
src-tauri/src/dock/
  geometry.rs    pure functions: tab rect, panel rect, hit tests (physical px)
  controller.rs  pure state machine; takes cursor samples, events, and a clock; returns actions
  poller.rs      the polling thread; feeds the controller; applies actions
  mod.rs         wiring, shared state
src-tauri/src/platform/
  macos.rs       NSPanel conversion, activation policy
  windows.rs     any Windows-specific window flags (only if M0 proves them necessary)
  linux.rs       Wayland detection, XWayland fallback
```

Controller sketch (verify all APIs before use):

```rust
pub enum Phase { Collapsed, Opening, Open, Closing }

pub enum Input {
    Cursor { x: f64, y: f64 },          // physical px, desktop coordinates
    SetKeepOpen(bool),
    SetInteractionLock(bool),           // editor/search focused, menu open
    AnimationDone(Phase),
    Toggle,                              // shortcut or tray
    WindowBlurred,
    PointerLeftWebview,                  // Linux secondary signal
    MonitorChanged,
}

pub enum Action {
    SetWindowRect(Rect),
    EmitState { phase: Phase, side: Side, tab_top_logical: f64, keep_open: bool },
    Focus,
}

impl DockController {
    pub fn handle(&mut self, input: Input, now: Instant) -> Vec<Action> { /* ... */ }
    pub fn tick(&mut self, now: Instant) -> Vec<Action> { /* open/close delays, ack timeouts */ }
    pub fn poll_interval(&self) -> Duration { /* adaptive */ }
}
```

The controller must not call Tauri directly. `poller.rs` applies the returned actions, which keeps the controller fully testable with a fake clock.

### 8.4 Open and close sequence (no flicker)

Open:

1. Controller enters `opening`. Rust sets the window to the expanded rect.
2. Rust emits `dock:state` with `phase: "opening"`, `side`, and `tabTop`. Until this moment the frontend keeps the panel translated fully past the docked edge, so growing the window reveals nothing new and the tab doesn't move on screen.
3. The frontend slides the panel in, then calls `dock_animation_done("opening")`.

Close:

1. Rust emits `phase: "closing"`. The frontend slides the panel out, then calls `dock_animation_done("closing")`.
2. Rust shrinks the window back to the tab rect. If no acknowledgment arrives within 300 ms, it shrinks anyway.

If the cursor re-enters during `closing`, reverse to `opening` without resizing the window.

If setting position and size as two calls causes a visible jump, apply them in the order that keeps the docked edge fixed, and check whether the current Tauri version or the NSPanel frame API offers an atomic bounds update.

### 8.5 Coordinates and monitors

- Rust works in physical pixels; CSS works in logical pixels. Convert once, at the boundary, using the monitor's scale factor.
- Dock inside the monitor's work area (`Monitor::work_area`), not its full bounds, so the tab never sits under the Windows taskbar or a side-docked macOS Dock. Use the latest Tauri 2.x; earlier versions had work-area bugs on macOS and Linux.
- Dock monitor setting defaults to the primary monitor. If the chosen monitor disappears, fall back to primary. Re-evaluate placement on scale-factor changes and every 2 seconds while collapsed.
- Store the tab's vertical position as a ratio (0–1) of the work-area height, so it survives resolution changes.
- Handle monitors with negative origins (displays placed left of or above the primary).

### 8.6 Focus

- Opening the panel never takes focus. Focus happens only when the user clicks inside it or uses the shortcut.
- macOS: enable `acceptFirstMouse` so the first click inside the panel acts immediately.
- After collapse, the previously active app should still have focus. Verify this explicitly on Windows.

### 8.7 Tauri window config (sketch)

```json
{
  "app": {
    "macOSPrivateApi": true,
    "windows": [
      {
        "label": "dock",
        "url": "index.html",
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "visibleOnAllWorkspaces": true,
        "resizable": false,
        "shadow": false,
        "focus": false,
        "acceptFirstMouse": true,
        "visible": false,
        "width": 28,
        "height": 88
      }
    ]
  }
}
```

Rust positions the window and shows it only after the frontend calls `app_ready`. The panel's CSS shadow needs room, so the expanded window includes a 12 px transparent margin on the three sides away from the screen edge. Hit-testing uses the panel rect, not the window rect.

### 8.8 macOS

- Set `ActivationPolicy::Accessory`: no Dock icon, no app menu bar.
- Use `tauri-nspanel` to convert the dock window into a panel that is non-activating, floats above normal windows, joins all Spaces, and can appear over full-screen apps. It must still be able to become the key window so typing works in the editor.
- Run panel operations on the main thread.
- Isolate all of this in `platform/macos.rs` so the dependency can be replaced if needed.
- `macOSPrivateApi` (required for transparency) rules out the Mac App Store. Plan for direct distribution with notarization.

### 8.9 Windows

- `skipTaskbar` and `alwaysOnTop` cover most of the behavior.
- In M0, verify that expanding the window does not activate it or steal focus. If it does, investigate extended window styles, but don't add any until you've confirmed typing in the editor still works afterward.
- Exclusive full-screen apps (some games) will cover the widget. That's accepted.
- Test at 100%, 150%, and 200% scaling, and on a mixed-DPI multi-monitor setup.

### 8.10 Linux

- X11 is supported directly.
- Wayland doesn't let apps position their own windows, and GNOME ignores always-on-top requests. For v1, when `XDG_SESSION_TYPE=wayland`, set `GDK_BACKEND=x11` at the very top of `main` before Tauri or GTK start, so the app runs under XWayland. Allow opting out with `LEDGE_NATIVE_WAYLAND=1`. In the Rust 2024 edition `std::env::set_var` is `unsafe`; call it before any threads are spawned.
- Risk to verify: under XWayland the global cursor position can go stale once the pointer is over native Wayland windows, which could keep the panel from closing. Mitigate by feeding webview `pointerleave` and window blur into the controller.
- Transparency needs a compositing window manager.
- Some NVIDIA and WebKitGTK combinations render a blank window; document the `WEBKIT_DISABLE_DMABUF_RENDERER=1` workaround in the README.
- Native Wayland support via the layer-shell protocol (KDE and wlroots compositors, not GNOME) is future work.

## 9. Data model and IPC

### 9.1 SQLite

Database file `notes.db` in the app data directory, WAL mode enabled.

```sql
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,            -- UUID v7
  content     TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL,               -- palette id from 7.3
  pinned      INTEGER NOT NULL DEFAULT 0,  -- reserved, post-v1
  sort_order  REAL,                        -- reserved, post-v1 manual ordering
  created_at  INTEGER NOT NULL,            -- unix ms
  updated_at  INTEGER NOT NULL,            -- unix ms
  deleted_at  INTEGER                      -- soft delete: undo now, sync later
);
CREATE INDEX idx_notes_active ON notes (deleted_at, updated_at DESC);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                      -- JSON
);
```

- Migrations: an ordered list of SQL steps tracked with `PRAGMA user_version`, run in a transaction at startup.
- Permanently purge notes soft-deleted more than 30 days ago, at startup.

### 9.2 Settings keys and defaults

| Key | Default |
|---|---|
| `dock.side` | `"right"` |
| `dock.monitor` | `"primary"` |
| `dock.tabOffset` | `0.5` |
| `dock.openDelayMs` | `120` |
| `dock.closeDelayMs` | `400` |
| `panel.width` | `320` |
| `theme` | `"system"` |
| `notes.lastColor` | `"yellow"` |
| `shortcut.newNote` | `"CmdOrCtrl+Alt+N"` |

### 9.3 Commands (frontend → Rust)

All commands return `Result<T, AppError>`, serialized as `{ code, message }`. Wrap each in a typed function in `src/lib/ipc.ts`; components never call `invoke` directly.

| Command | Purpose |
|---|---|
| `notes_list()` | Active notes, most recently edited first |
| `notes_create(color)` | Create an empty note |
| `notes_update(id, content?, color?)` | Partial update; bumps `updated_at` |
| `notes_delete(id)` | Soft delete |
| `notes_restore(id)` | Undo a delete |
| `settings_get()` | All settings with defaults applied |
| `settings_update(patch)` | Persist and apply immediately (dock side, delays, and so on) |
| `dock_set_keep_open(bool)` | Keep open toggle |
| `dock_set_interaction_lock(bool)` | Editor, search, or menu active |
| `dock_animation_done(phase)` | Slide animation finished |
| `dock_toggle()` | Open or close programmatically |
| `app_ready()` | Frontend painted; show the window |

### 9.4 Events (Rust → frontend)

| Event | Payload |
|---|---|
| `dock:state` | `{ phase, side, tabTop, keepOpen }` |
| `settings:changed` | Full settings object |
| `ui:new-note` | None; sent by the global shortcut and tray |

### 9.5 Capabilities

The frontend needs only event listening and the custom commands above. Don't grant window, filesystem, shell, or SQL permissions to the webview.

## 10. Project structure

```
ledge/
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ styles/
│  │  ├─ tokens.css          chrome tokens and note palette, light and dark
│  │  └─ global.css          resets, font stack, scrollbars, focus ring
│  ├─ dock/                  DockShell, Tab, panel slide logic, dock:state listener
│  ├─ notes/                 NoteList, NoteCard, NoteEditor, ColorFilter, SearchField, EmptyState
│  ├─ components/            IconButton, Tooltip, Toast
│  ├─ store/                 notes, settings, and dock stores (Zustand)
│  └─ lib/
│     ├─ ipc.ts              typed wrappers for every command and event
│     └─ notes.ts            title/preview derivation, sorting, filtering (pure, tested)
├─ src-tauri/
│  ├─ tauri.conf.json
│  ├─ capabilities/default.json
│  └─ src/
│     ├─ main.rs             Linux env setup, then lib::run()
│     ├─ lib.rs              builder, plugins, setup
│     ├─ dock/               geometry, controller, poller
│     ├─ platform/           macos, windows, linux
│     ├─ db/                 connection, migrations, notes repo, settings repo
│     ├─ commands.rs
│     ├─ tray.rs
│     └─ error.rs
└─ README.md
```

## 11. Quality bar

- **TypeScript:** strict mode, no `any`, ESLint and Prettier.
- **Rust:** `cargo fmt`, `cargo clippy` with no warnings, no `unwrap`/`expect` outside startup code and tests.
- **Unit tests:**
  - Geometry for both sides, several scale factors, clamping, and negative monitor origins.
  - Controller transitions with a fake clock, including re-entry during closing, the interaction lock, and the acknowledgment timeout.
  - Notes and settings repositories against in-memory SQLite.
  - Frontend title and preview derivation, sorting, and filtering (Vitest).
- **Performance:** idle CPU near 0% (measure and report); 60 fps slide animation; visible tab in under 1 second from launch; installer under about 15 MB.
- **Accessibility:** fully keyboard operable, visible focus everywhere, WCAG AA contrast including text on every note color, reduced motion respected.
- **No data loss:** debounced autosave, save on editor close, flush on quit.

## 12. Milestones

### M0: Docking spike

Build the window config, geometry, controller, poller, and open/close behavior with a placeholder panel (plain surface plus tab). Add the Keep open toggle and, on macOS, the NSPanel conversion and Accessory policy.

Acceptance on macOS and Windows (and Linux X11 if available):

- [ ] Tab is visible at the edge above other apps, with no taskbar or Dock icon
- [ ] Hovering while another app is focused opens the panel and does not steal focus
- [ ] Leaving closes the panel after the delay; re-entering during close reverses it
- [ ] Clicks outside the tab and panel reach the apps underneath
- [ ] The first click inside the panel works while another app is active (macOS)
- [ ] Typing into a test input works after clicking into the panel
- [ ] The panel appears over full-screen apps and on every Space (macOS)
- [ ] Placement is correct at 100%, 150%, and 200% scaling and on a secondary monitor
- [ ] No flash or jump at startup, open, or close

Report the result of each item. If anything fails, propose options before continuing.

### M1: Notes core

SQLite with migrations, notes commands, typed IPC, notes store, card list, create, inline editor with autosave, delete with undo, empty state, full token system with light and dark themes.

### M2: Find and organize

Search, color filter, keyboard navigation, editor footer (colors, edited time), interaction lock while editing or searching.

### M3: System integration

Tray menu, live dock side switching, launch at login, global shortcut, single instance, logging, Linux Wayland fallback.

### M4: Polish

A small settings view inside the panel (theme, delays, width, monitor, shortcut), dragging the tab to reposition it along the edge, export all notes (one Markdown file per note plus a JSON backup), reduced-motion pass, accessibility pass, performance measurements.

### M5: Packaging

macOS `.dmg` with notarization steps documented, Windows installer, Linux `.AppImage` and `.deb`, app and tray icons, and a README covering platform notes and known limitations.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| macOS inactive windows don't get mouse events | Cursor polling in Rust; NSPanel; no hover-only UI |
| `tauri-nspanel` is a community git dependency | Pin a commit; isolate in `platform/macos.rs` |
| Flicker when resizing the window | Animate content, not the window; keep the docked edge fixed; look for atomic bounds updates |
| Windows focus stealing on expand | Verify in M0 before adding any window-style workarounds |
| Wayland positioning and stale cursor under XWayland | XWayland fallback; `pointerleave` and blur as secondary signals |
| Crashes from heavy cursor or monitor queries | One polling thread at modest rates; stay on the latest Tauri 2.x |
| `macOSPrivateApi` blocks Mac App Store | Distribute directly with notarization |
| WebKitGTK blank window on some NVIDIA setups | Document environment-variable workaround |

## 14. Suggestions and future ideas

Already included in v1 above: hover-intent delay, no auto-close while editing, soft delete with undo instead of confirmation dialogs, first-line titles (no separate title field), a global new-note shortcut, and export.

For later, in rough priority order:

1. **Quick capture.** A shortcut that opens a single-line input near the tab; Enter saves a note without opening the full panel.
2. **Sync across devices.** UUID v7 ids plus `updated_at` and `deleted_at` already support last-write-wins sync. Consider end-to-end encryption, since people put private things in notes.
3. **Lightweight formatting.** Checklists (`[ ]` / `[x]`), bold, and clickable links, still stored as plain text.
4. **Pin notes and drag to reorder**, using the reserved `pinned` and `sort_order` columns.
5. **Full-text search** with SQLite FTS5 once note counts grow.
6. **Clipboard to note.** A shortcut that creates a note from the current clipboard text.
7. **Per-monitor docks**, with a different edge per monitor.
8. **Optional translucent panel background** (macOS vibrancy, Windows Mica) as a theme option, keeping solid surfaces as the default.
9. **Native Wayland** via layer-shell on KDE and wlroots compositors.
