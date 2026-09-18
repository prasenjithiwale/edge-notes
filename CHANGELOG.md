# Changelog

Every release of Ledge, newest first. Versions follow
[semantic versioning](https://semver.org); while the version is `0.x`, any release
may change behaviour. Downloads for every platform are at
<https://prasenjithiwale.github.io/edge-notes-apt/>, which is also where this
file is published — this repository is private, so its Releases page is not a
public link.

To release, see "Releasing" in the README.

## [Unreleased]

## [0.6.1] - 2026-09-18

### Fixed

- **The Windows installers are back.** 0.6.0's encryption work builds OpenSSL
  from source, and OpenSSL's build is a Perl program: on the Windows build
  machine it picked up the cut-down Perl that comes with Git rather than the
  complete one, and stopped before it compiled anything. Nothing about the app
  changed — 0.6.0 simply never produced a Windows build, so this is that build.

## [0.6.0] - 2026-09-18

### Added

- **Your notes are encrypted on disk.** `notes.db` is now SQLCipher — AES-256,
  every page, the schema included — with the key kept in the macOS Keychain,
  Windows Credential Manager or the Linux Secret Service. A database from an
  earlier version is converted the first time this one opens it, and the
  plaintext copy is removed once the encrypted one has been checked. A backup
  tool, a sync folder or a stolen disk now gets a file of noise.
- **A recovery key, in Settings › Privacy.** It is the same key, written out in
  eight groups of eight. Keep it: a keychain that is reset or left behind on
  another machine is otherwise notes nobody can read, this app included. If that
  happens the panel says so and offers to unlock with the key — and "Start fresh"
  renames the locked file rather than deleting it.
- **The panel stays out of screen shares, recordings and screenshots**, on by
  default, with a switch in Settings › Privacy. A widget that slides out on hover
  is easy to open by accident while presenting. macOS and Windows only: Linux has
  no way to ask for it, so the switch is not shown there.

### Changed

- **The note colours have colour in them now.** The sixteen were so pale they
  read as one wash; each keeps its hue and gets two to four times the saturation,
  in both themes. Text on them, and the medium-priority flag, were re-tuned to
  stay above the contrast bar on the deeper cards.

## [0.5.1] - 2026-09-18

### Fixed

- **The panel opens without the tab flashing into the middle of the screen.**
  For an instant at the start of every open, the tab was drawn where the panel's
  top-left corner was about to be, and then vanished. macOS applies a window's
  move and its resize as two separate changes, so the still-collapsed window was
  moved into place before it grew, carrying the tab with it; Ledge now sets the
  whole frame in one go, and keeps the panel out of sight for the two frames it
  takes the webview to catch up.

## [0.5.0] - 2026-09-18

### Added

- **Notes have headings now: `# `, `## ` and `### `.** Type the hashes, press
  <kbd>⌘⌥1</kbd>, <kbd>⌘⌥2</kbd> or <kbd>⌘⌥3</kbd>, or use `/heading` — the slash
  menu has all three at the top. A note's first line is what the list shows as
  its name, so making it a Heading 1 is how a note gets a title, and the title
  now looks like one on the card as well as in the editor.
- **Delete something for good, from the archive.** Each row has a bin beside its
  Restore; it asks once, and then the thing is gone rather than waiting out its
  thirty days. It is the only action in Ledge with no undo behind it, which is
  why it is the only one that asks.

### Changed

- **The archive button sits beside the settings gear**, where it belongs, rather
  than adrift in the middle of the toolbar.

## [0.4.2] - 2026-09-18

### Added

- **An Archive, beside the settings gear at the foot of the panel.** Everything
  you delete is kept for thirty days — that was always true, but the undo toast
  was the only way to see it, so a delete you noticed a minute later looked
  final. The archive lists deleted notes and tasks together, newest first, with
  how long each one has left and a Restore beside it. The button is not
  clickable while there is nothing to restore, and says how many there are.

### Fixed

- **A status chosen in a task's sheet takes effect at once.** Setting one to
  Cancelled left the row sitting under In progress until you left the tab and
  came back — the list disagreeing with the sheet open inside it. Only a tick
  holds a row in place now, which is what that rule was for: stopping the box you
  just pressed from throwing the row into Done from under your finger.

## [0.4.1] - 2026-09-18

### Changed

- **Every link in the app now goes somewhere you can open.** Settings › About
  had one link, to the downloads page; it now has three — downloads, what is new
  in each release, and where to report a problem — and none of them point into
  the private source repository.
- **The changelog is published on the downloads site**, at
  [changelog.html](https://prasenjithiwale.github.io/edge-notes-apt/changelog.html),
  rather than being a link into a repository nobody outside can read.
- **The site has a light and dark switch.** It still follows the system by
  default; the switch is for when you want the other one, and it is remembered.

## [0.4.0] - 2026-09-18

### Added

- **A task has a status now: Open, In progress, Done or Cancelled.** A tick
  answered one question — is this finished — and the two answers it could not
  give are the ones you want most: what am I in the middle of, and what did I
  decide against. The box in the row still finishes a task in one press; the new
  Status control in its details sheet is where a task is started or dropped.
- **In progress is the first section in the list**, above Today, because a task
  you have started is where you were. Cancelled sits at the bottom beside Done,
  folded away, and both stop being listed a day later.
- **Cancelled is closed without being finished.** It is not counted on the tab,
  it raises no reminder, and it is never mistaken for work that was done. The
  record stays — deciding against something is worth remembering — and ticking a
  cancelled task says you did it after all.
- **The row shows the status without being asked**: a half-filled ring for a task
  in progress, with a hairline down the edge of its row, and a struck circle for
  one that was cancelled. Both read in a screenshot and to a screen reader, not
  only in colour.

### Fixed

- **You can click anywhere in an expanded note.** The writing surface stopped at
  the last line and at the edges of the reading column, so most of the large
  panel was dead: pressing there put the caret nowhere, and the arrow keys were
  the only way to reach a line. The column is now the editable's own margin, and
  it fills the panel, so a press anywhere in it lands on the nearest line.
- **No blue box round the line you are writing on.** The editor asked for no
  focus ring and did not get its way: the app's accent ring is drawn with a bare
  `:focus-visible`, which ties with a plain class and wins on order, so the ring
  came back on the text — and on the single check list line the caret was on,
  because a check list item can hold focus.
- **A finished task can be unfinished again.** Ticking a task holds its row
  among the open ones rather than letting it jump to Done under the cursor, and
  the box was reading its state from that held copy instead of from the task. It
  stayed filled whatever the store said, so the next press read as another tick.
- **You can click anywhere in a note again.** Clicking in the middle of a line
  would not put the caret there: the whole line highlighted instead, and the
  arrow keys moved a line at a time rather than a character. One missing
  declaration — the editor turned text selection back on with `user-select` but
  not `-webkit-user-select`, and WebKit honours the second one.

### Added

- **A note can have no colour.** The first swatch in the palette takes the colour
  off; the card keeps a neutral surface of its own and a hairline, so it still
  reads as a card in both light and dark rather than merging into the panel.
- **The tab at the screen edge comes in three sizes.** Settings › Appearance ›
  Tab size: small, medium or large. The hit area grows with it, so a bigger tab
  is easier to hit and not only easier to see.

### Changed

- **The note editor's header is the note's own buttons now.** Expand on the
  left; lock, delete and done on the right, with done as a tick rather than the
  word. The row of formatting icons has gone — every one of them is on a keyboard
  shortcut and in the slash menu, and eight icons on a card this size crowded out
  the controls you actually reach for.

### Added

- **`/bold`, `/italic`, `/strike` and `/code`**, alongside the block commands the
  slash menu already had. The menu is in two parts now — what to turn the line
  into, then how to style the text — and each row shows the keyboard shortcut
  that does the same thing.

## [0.3.0] - 2026-09-17

### Added

- **Type `/` in a note to change what the line is.** A menu opens with Text,
  To-do list, Bulleted list, Numbered list and Code block; keep typing to narrow
  it — `/todo`, `/ul`, `/code` — then Enter, or click. Arrow keys move, Escape
  closes the menu and leaves the note alone.

## [0.2.1] - 2026-09-17

### Fixed

- **The app no longer freezes, or disappears, while you write.** Opening a note
  put the editor into a loop that never stopped: it redrew itself hundreds of
  times a second, which froze the window, and on Linux the kernel eventually
  killed the app outright. Reported on Linux; it was not Linux's fault and could
  happen anywhere.
- **Two methods the editor needs are now supplied where the system is too old to
  have them**, rather than failing the first time you typed a list or a link.

## [0.2.0] - 2026-09-17

### Changed

- **The note editor is a normal editor now.** Bold looks bold while you type;
  there are no `**` to read or to learn. The toolbar and its shortcuts do the
  formatting, and a button lights up when the caret is already inside what it
  does. Typing Markdown still works if that is your habit — `**bold**`, `- `,
  `1. `, `- [ ] ` — it is just no longer the only way in.

  Notes are still stored as Markdown, exactly as before, so nothing needed
  converting and an export is unchanged.

### Added

- **Code blocks in notes, with syntax highlighting.** The editor has a **Code
  block** button, and `⌘⇧C`, that drops a code box into the note. Pick the
  language from the dropdown on the box itself — JSON, JavaScript, TypeScript,
  Python, Java, Kotlin, C, C++, C#, Go, Rust, Swift, SQL, Shell, YAML, HTML or
  CSS — and type; the colours arrive as you go.

  Comments, strings, numbers, keywords and keys each get their own colour, on the
  box's own neutral panel so the note keeps its colour. Tab indents inside it,
  long lines scroll sideways rather than being broken in the middle, and the box
  has its own buttons to copy the code or remove it.

  A block is an ordinary Markdown fence, so a note with code in it is still clean
  Markdown when exported.
- **Inline code**, with `⌘E` or a pair of backticks. What is between them is
  taken literally, so `**` inside it stays `**`.
- **An About section in Settings**, with the version, the system it is running
  on, and where your notes are kept on disk. There is a button that copies all
  three, for when something goes wrong and you need to say what you are running,
  and a link to the downloads page.
- **The tab shows a red light while a focus session is running**, pulsing gently
  at the screen edge, so a session counting down behind whatever you are working
  in is visible without opening anything. It goes out by itself when the phase
  ends, and it stops pulsing if you have asked your system for less motion.

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
