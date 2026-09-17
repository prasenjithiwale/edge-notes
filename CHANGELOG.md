# Changelog

Every release of Ledge, newest first. Versions follow
[semantic versioning](https://semver.org); while the version is `0.x`, any release
may change behaviour. Releases are published on
[GitHub Releases](https://github.com/prasenjithiwale/edge-notes/releases).

To release, see "Releasing" in the README.

## [Unreleased]

### Changed

- **The note editor is a normal editor now.** Bold looks bold while you type;
  there are no `**` to read or to learn. The toolbar and its shortcuts do the
  formatting, and a button lights up when the caret is already inside what it
  does. Typing Markdown still works if that is your habit — `**bold**`, `- `,
  `1. `, `- [ ] ` — it is just no longer the only way in.

  Notes are still stored as Markdown, exactly as before, so nothing needed
  converting and an export is unchanged.
- **A code block is a box with a language dropdown**, rather than a list of every
  language shown before you have written anything. Pick the language on the block
  itself, change it whenever, and type into a real text box — with the colours
  arriving as you type. Tab indents inside it, and the block has its own copy and
  remove buttons.

### Added

- **Code blocks in notes, with syntax highlighting.** The editor has a **Code
  block** button that opens a list of languages — JSON, JavaScript, TypeScript,
  Python, Java, Kotlin, C, C++, C#, Go, Rust, Swift, SQL, Shell, YAML, HTML and
  CSS — and wraps what you have selected, or opens an empty block where the caret
  is. `⌘⇧C` does the same in the language you picked last.

  Comments, strings, numbers, keywords and keys each get their own colour, on the
  block's own neutral panel so the note keeps its colour. The block carries its
  language and a button to copy the code, its text is selectable, and long lines
  scroll sideways inside it rather than being broken in the middle.

  A block is an ordinary Markdown fence, so a note with code in it is still clean
  Markdown when exported. Formatting shortcuts do nothing inside one: the point
  of a code block is that its text is exactly what you typed.
- **Inline code**, with `⌘E` or a pair of backticks. What is between them is
  taken literally, so `**` inside it stays `**`.

## [0.1.0] - 2026-09-17

### Added

- **Search searches the tab you are looking at.** `⌘F` on the Tasks tab searches
  the tasks — titles and the notes under them — instead of throwing you back to
  the notes, and says so when nothing matches.
- **The Tasks tab is fully keyboard-operable.** Arrow keys move between tasks,
  Space ticks the one you are on, Enter opens its details, and `⌘N` puts the
  caret in the add field.
- **Quick entry understands ordinary words, and shows what it understood.** Type
  `ship it @fri 2pm !!!` and the chips under the field say Friday, 2:00 pm and
  High before you press Enter. `@today`, `@tomorrow`, any weekday, times as
  `14:00`, `2pm` or `2:30 pm`, and `!!!`/`!!` alongside the older `@2026-09-20`
  and `!high`. A word after `@` that is not a date stays part of the task.
- **The Focus tab's lengths are settings.** Session, short break, long break and
  how many sessions earn the long one, each nudged with a stepper. Changing a
  length while a session is running leaves that session ending where it was
  always going to; the new length starts with the next phase.
- **The Focus tab remembers.** The day's count and the run towards the long break
  survive quitting the app, and so does the task a session is for.
- **A focus session can name the task it is for.** Pick one on the Focus tab, or
  press "Focus on this" in a task's details, and the tab shows what you are
  working on — the notification at the end names it too. There is a tick beside
  it for finishing the task without leaving the tab.
- **Start the next phase automatically**, if you want it: a switch in Settings,
  off by default. The break starts when the session ends is *noticed*, not when
  it ran out, so coming back late never hands you a break that is already over.
- **The clock says when it ends.** "Ends 3:45 pm" under the countdown, and the
  full length of the phase before it has started.
- **A dot on the Focus tab while a session is running**, so a timer counting down
  behind the Notes tab is not invisible.
- **Ledge installs from Homebrew on macOS**, from a tap of its own:

  ```bash
  brew trust --cask prasenjithiwale/tap/edge-notes
  brew install --cask prasenjithiwale/tap/edge-notes
  ```

  The `.dmg` is published to the downloads site alongside the Linux and Windows
  packages, and `brew upgrade` brings new versions. The app is not signed with an
  Apple Developer ID, so the cask removes the quarantine attribute that would
  otherwise stop macOS opening it — which also means it is installed without a
  Gatekeeper check.
- **A new task can choose its note.** The Tasks tab's "Add a task" row now has a
  picker beside the field naming the note the task will go to, with that note's
  colour as a dot. Every note is offered; the note titled Tasks is still the
  default, so typing and pressing Enter works exactly as it did.
- **A Focus tab, with a pomodoro timer.** Twenty-five minutes of focus, five
  off, fifteen after every fourth one, with start, pause, reset and skip, the run
  of four shown under the clock and a count of what you finished today. A session
  that ends while the panel is closed sends a notification, and the clock is kept
  as the time it ends rather than a number counted down, so it is still right
  after the widget has sat behind another app for twenty minutes.
- **The dock side and Launch at login are in Settings**, not only in the tray
  menu. Screen edge sits under Dock; Launch at login is read from the system, so
  it matches the login item even when that is changed outside the app. The tray's
  ticks follow a change made in the panel.
- **The search field has a clear button.** Searching replaces the Notes and Tasks
  tabs, so with Esc the only way out a mouse had no way back to the list.

### Changed

- **Edge Notes is now called Ledge.** The window, the tray, the export folder and
  every download are named after it, and the bundle identifier moved with it
  (`dev.edgenotes.app` → `dev.ledge.app`).

  That identifier is what the app-data folder is named after, so **the first
  launch copies your database across** — notes, tasks and settings all come with
  it. The old folder is left exactly where it is, so an older build still opens
  on its own data and nothing is lost if the copy goes wrong. Once you are
  happy, you can delete `~/Library/Application Support/dev.edgenotes.app`
  (`%APPDATA%\dev.edgenotes.app` on Windows,
  `~/.local/share/dev.edgenotes.app` on Linux).

  On Debian and Ubuntu the package is now `ledge`: `sudo apt install ledge`
  replaces `edge-notes` rather than installing a second copy. The Homebrew cask
  keeps its old name, `prasenjithiwale/tap/edge-notes`, so `brew upgrade` still
  works for anyone who installed before this release. The Linux opt-out for
  native Wayland is now `LEDGE_NATIVE_WAYLAND=1`.
- **The Tasks tab looks and behaves like a list.** Each task is a row with its
  own background under the cursor and the keyboard, a round tick box, its
  priority flag in front of the title rather than off at the edge, and a chevron
  that says it opens. Sections fold away and keep their counts; Done starts
  folded.
- **Settings is four cards instead of one long column.** Each group is boxed,
  every setting's name is readable rather than small print, and the ones with a
  name that is not the whole story have a line of explanation. The two hover
  delays and the panel width moved behind **Advanced**.
- **Tasks are their own thing, not lines inside notes.** A task now has real
  fields — title, notes, due date and time, priority, repeat — instead of tokens
  at the end of a `- [ ]` line, and it no longer needs a note to live in. The
  Tasks tab is a task list: add without choosing a note, grouped into Overdue,
  Today, Tomorrow, Upcoming and Someday, with what you finished today behind a
  Done toggle.

  Tasks already written into notes are moved across the first time this version
  starts, keeping their priority, due date and repeat. The lines are removed from
  the notes, and a note that held nothing but tasks is moved to the deleted notes
  it can be restored from for 30 days.

  Notes still have checkboxes for ad-hoc lists — they tick, and Enter still
  continues the list — but they are formatting now, and do not appear in the
  Tasks tab.
- **Typing the old shorthand still works** where it is most useful: put
  `!high @2026-09-20 14:00 repeat:weekly` after a task in the add field and the
  details are filled in for you.
- **Settings and Keep open moved to the foot of the panel.** They change the
  panel itself, while everything else in the header acts on what is in it — and
  four icons beside the tabs were easy to mis-hit. They are the same on every tab
  now.
- **The new note shortcut is recorded by pressing it.** The setting used to be a
  text field holding Tauri's accelerator syntax (`CmdOrCtrl+Alt+N`); it is now a
  button you press the keys into, and it shows them the way the platform does —
  ⌘⌥N on macOS, Ctrl + Alt + N elsewhere.
- **Settings is grouped into Appearance, Dock and General**, and the settings
  that are simply on or off — Task reminders, Launch at login — are switches
  rather than pairs of On/Off buttons.
- **An expanded note is set in a column** about seventy characters wide instead
  of running the full width of the large panel.
- **The collapsed tab is easier to see**, particularly in dark mode over a dark
  desktop, where its outline had almost no contrast to carry its shape.
- **Keep open looks like the mode it is**, filling its button rather than only
  tinting the pin.
- **A locked note's card is no taller than its text.** Its three buttons sit in a
  row instead of a stack, which used to set the height of the card.
- **The macOS app is ad-hoc signed.** The bundle used to ship unsealed, with only
  the executable carrying the linker's signature and an identity of
  `ledge-<hash>` rather than `dev.edgenotes.app`. It is still not signed with
  a Developer ID.
- **Priority flags are coloured** — red for high, amber for medium, green for
  low, on the card, the Tasks tab and the details picker. The flag is still
  filled for high and thinner for low, so priority does not depend on seeing
  colour. Every colour is checked against all sixteen note backgrounds in both
  themes.

### Fixed

- **Opening a task's details on the last row scrolls it into view** instead of
  unfolding it below the fold.
- **A shortcut the system refuses no longer leaves you with none.** Setting the
  new note shortcut to a combination another application owns used to unbind the
  old one, store the new one, fail to register it, and say nothing. The shortcut
  is now registered before it is stored, the previous one is put back if that
  fails, and the settings field says what happened.
- **Deleting a note no longer takes the undo with it.** Moving the cursor away
  after a delete collapsed the panel while the "Note deleted" toast was still
  counting down. The toast holds the panel open, as brief 6.3 always said it
  should.
- **A note edited less than a minute ago reads "Edited just now"** rather than
  "Edited 0m ago" for the fifteen seconds before the first minute.
- **Focus rings stop glowing when the panel does not have the keyboard.** The
  widget is inactive most of the time, and a lit ring on a field whose keystrokes
  were going to another app was a promise it could not keep.
- **An empty search result appears near the top of the panel**, not centred three
  hundred pixels below the field being typed into.
- **The priority chips in the task details sheet** run None, Low, Medium, High
  rather than None, High, Medium, Low.
- **Linux: the window is no longer called "Tauri App".** Switching apps with
  Alt+Tab on Ubuntu showed the widget under Tauri's default window title, which
  had never been set. It was set to "Edge Notes", the app's name at the time.

## [0.0.4] - 2026-09-15

macOS (universal), Linux (x86_64) and Windows (x64).

### Added

- **Windows downloads on the download page.** The Windows installer and `.msi`
  are now published to
  [prasenjithiwale.github.io/edge-notes-apt](https://prasenjithiwale.github.io/edge-notes-apt/),
  the same page that serves the Debian and Ubuntu packages, with a `SHA256SUMS`
  file to check them against. Every release is built there and checked by
  downloading it again from the live page.

### Changed

- **A locked note shows all of itself.** Locking a note kept it in front of you
  but still showed a preview: long notes stopped at "N more", and lines typed
  separately ran together into one. A locked note now shows its whole content,
  each line on its own line, with blank lines kept as the paragraph breaks they
  are. Unlocked cards still preview as before.

## [0.0.3] - 2026-09-15

A fix for Linux. macOS (universal), Linux (x86_64) and Windows (x64).

### Fixed

- **Linux: the tab no longer moves inwards after the panel closes.** On KDE Plasma
  (seen on Kubuntu) the tab ended up where the open panel's left edge had been,
  and the next open started from there, half on screen. The window manager
  received the window's move before its resize and pulled the still-wide window
  back on screen. The tab now waits for its new size before moving, checks where
  it actually landed and corrects it, and is put back at the edge if anything
  moves it later.

## [0.0.2] - 2026-09-14

macOS (universal), Linux (x86_64) and Windows (x64).

### Added

- **Tasks tab.** Tabs at the top of the panel switch between Notes and Tasks. The
  Tasks tab gathers every checklist item from every note, with the number still
  open on the tab. Tick tasks there and the note updates; a task
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
