# Changelog

Every release of Edge Notes, newest first. Versions follow
[semantic versioning](https://semver.org); while the version is `0.x`, any release
may change behaviour. Releases are published on
[GitHub Releases](https://github.com/prasenjithiwale/edge-notes/releases).

To release, see "Releasing" in the README.

## [Unreleased]

### Added

- **Tasks tab.** Tabs at the top of the panel switch between Notes and Tasks. The
  Tasks tab gathers every checklist item from every note, grouped by note, with
  the number still open on the tab. Tick tasks there and the note updates; a task
  ticked stays in place until you leave the tab, then moves under "Done". "Add a
  task" adds to the note titled Tasks (or To-Do), creating it the first time.
  Pressing a task's note name opens the note. Switching tabs slides.
- **Task details.** Tasks can have a priority, a due date and time, and a repeat
  (daily, weekly, monthly, yearly), set from a details button on the Tasks tab or
  typed at the end of a checklist line (`!high @2026-09-20 14:00 repeat:weekly`).
  The Tasks tab groups tasks into Overdue, Today, Upcoming and No date, highest
  priority first; cards show the details as small chips. Ticking a repeating task
  moves it to its next date.
- **Reminders.** A system notification when a task is due, or at 9:00 for a task
  with a date but no time. Can be turned off in Settings.
- **Cards with depth.** Note cards have a soft shadow, and an open note sits a
  step higher.
- **Panel translucency.** A slider in Settings makes the panel see-through, up to
  60 %.

## [0.0.1] - 2026-09-14

The first release. macOS (universal: Apple Silicon and Intel), Linux (x86_64) and
Windows (x64).

### The widget

- A small floating tab docked to the left or right screen edge, above other apps.
  Point at it (or click it, if you prefer) and a panel of notes slides out; move
  away and it slides back.
- Drag the tab along the edge to place it. Keep open pins the panel out.
- Tray menu: open notes, new note, dock side, launch at login, quit.
- Global shortcut `Cmd+Alt+N` (`Ctrl+Alt+N` on Linux) for a new note.

### Notes

- Create, edit, delete with undo, search, and filter by colour.
- Sixteen note colours, readable in light and dark themes.
- Formatting kept as plain Markdown: bold, italic, strikethrough, bulleted and
  numbered lists, checklists you can tick from the card, and clickable links.
- Expand a note into a large panel to read or edit it comfortably.
- Lock a note to keep it at the top and read-only until you choose to edit it.
- Click outside an unchanged note to stop editing.
- Export every note as Markdown plus a JSON backup.
- Everything is stored locally in SQLite; nothing leaves your machine.

### Known limitations

- Not signed: macOS and Windows both ask for confirmation the first time (see the
  release notes).
- On macOS, a panel opened with the shortcut needs one click before it takes
  typing.
- Linux runs under X11 or XWayland; native Wayland is not supported yet.
- The Windows and Linux builds have not yet been tried on real hardware.
