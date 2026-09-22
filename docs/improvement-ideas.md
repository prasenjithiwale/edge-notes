# Ledge: improvement ideas

Twenty ideas for security, reliability, distribution and features, researched on
15 Sep 2026 against the current code (v0.0.3), the gaps recorded in
[progress.md](progress.md), the brief's own future list (brief 14), current Tauri
2 documentation, and what comparable note widgets offer. Sources are at the end.

Nothing here is decided or scheduled. Where an idea needs a dependency outside
brief section 4, it says so, because the project rules require asking first.

**Effort:** S = a day or two, M = about a week, L = several weeks.
**Impact:** how much a user or the project would notice.

## At a glance

| # | Idea | Area | Effort | Impact | Status |
|---|---|---|---|---|---|
| 1 | Hide the panel from screen sharing and screenshots | Security | S | High | **Built, 0.6.0** |
| 2 | Encrypt notes at rest, key in the OS keychain | Security | M | High | **Built, 0.6.0** |
| 3 | Lock down the IPC: isolation pattern, per-command permissions, stricter CSP | Security | S–M | Medium |
| 4 | Sign and notarise macOS and Windows builds | Security / distribution | M | High |
| 5 | Supply-chain checks in CI | Security | S | Medium |
| 6 | Automatic updates | Distribution | M | High |
| 7 | Automatic backups, and import | Reliability | S–M | High |
| 8 | Close the macOS keyboard-focus gap | Reliability | S–M | Medium |
| 9 | Native Wayland docking with layer-shell | Reliability (Linux) | L | Medium |
| 10 | Upgrade to Tauri 2.12 when it ships | Reliability | S | Medium |
| 11 | Continuous integration on every push | Reliability | S | Medium |
| 12 | More install channels | Distribution | M | Medium |
| 13 | Real full-text search | Feature | M | High |
| 14 | Quick capture and clipboard to note | Feature | S–M | High | **Built, 0.7.0** |
| 15 | Sync across devices, end-to-end encrypted | Feature | L | High |
| 16 | Tags, and drag to reorder | Feature | M | Medium | **Built, 0.7.0** |
| 17 | Images and screenshots in notes | Feature | M–L | Medium | **Paste and drop built, 0.7.0** |
| 18 | Notes pinned to an app or website | Feature | M–L | Medium |
| 19 | Snooze a note, and calendar export for tasks | Feature | S–M | Medium |
| 20 | Accessibility, localisation and a diagnostics button | Quality | M | Medium |

**If only three:** 1 (small, and protects exactly what people put in notes),
7 (no data loss is a brief 11 promise, and there is no backup today), and
6 (every fix so far has needed a manual reinstall).

---

## Security and privacy

### 1. Hide the panel from screen sharing and screenshots

**Built in 0.6.0** — `privacy.hideFromCapture`, on by default. See
[progress.md](progress.md) for what was measured.

**What.** A setting, on by default, that stops the panel appearing in screen
shares, recordings and screenshots, so a note with a password or a private
reminder does not end up on a video call.

**Why.** A notes widget that slides out on hover is easy to open by accident while
presenting. Windows already offers this to apps, and macOS excludes a window from
capture when asked.

**How.** Tauri 2 windows have content protection (`contentProtected` in the
window config, `set_content_protected` at runtime), which maps to
`NSWindow.sharingType = .none` on macOS and `SetWindowDisplayAffinity` on Windows.
Linux has no equivalent; the setting would be hidden there. Needs checking that it
survives the NSPanel conversion in `platform/macos.rs`.

**Effort** S. **New dependencies** none.

### 2. Encrypt notes at rest, with the key in the OS keychain

**Built in 0.6.0** — SQLCipher plus `keyring`, with a recovery key and a locked
state. See [progress.md](progress.md); the recovery key is what stands in for
the backups of idea 7, which are still not built.

**What.** `notes.db` encrypted on disk, unlocked automatically with a key kept in
the macOS Keychain, Windows Credential Manager or the Linux Secret Service.
Optionally, an app lock (Touch ID / Windows Hello) after idle time.

**Why.** Notes are plain SQLite in the app data folder today: anything with read
access to the user's files, a backup tool or a stolen unencrypted disk can read
them. Notes attract passwords and personal details.

**How.** rusqlite's `bundled-sqlcipher-vendored-openssl` feature statically links
SQLCipher (AES-256 page encryption) instead of plain SQLite, so the database code
barely changes: set `PRAGMA key` on open. The key is a random 32 bytes stored with
the `keyring` crate. Migration: open the old file, `ATTACH` an encrypted copy,
`sqlcipher_export`, swap. Export (Markdown/JSON) stays plaintext by design, which
the settings should say.

**Effort** M. **New dependencies** `keyring`, and a different rusqlite feature
(pulls in OpenSSL): both need approval. **Risk** a lost keychain entry means lost
notes, so pair it with idea 7's backups and a recovery key.

### 3. Lock down the IPC layer

**What.** Three hardening steps Tauri recommends:

- **Isolation pattern.** A tiny sandboxed script sits between the webview and
  Rust and validates every IPC message before it is encrypted (AES-GCM) and passed
  on. Protects against a compromised frontend dependency calling commands.
- **Per-command permissions.** `progress.md` records that the app's own commands
  are not gated by the capability system. Declaring them in `build.rs`
  (`AppManifest::commands`) and allowing only those used, per window, makes the
  allow-list explicit.
- **Stricter CSP.** `style-src` still allows `'unsafe-inline'`, needed because
  components set CSS variables through `style` attributes. Moving those to data
  attributes or a nonce would let it go.

**Why.** Brief 9.5's principle is that the webview gets nothing it does not need.
The `open_url` command is the one that reaches outside the app; it validates its
input, but the fewer paths to it, the better.

**Effort** S–M. **New dependencies** none.

### 4. Sign and notarise the macOS and Windows builds

**What.** A Developer ID signature and Apple notarisation for the `.dmg`, and an
Authenticode signature (for example Azure Trusted Signing) for the Windows
installers, done in the release workflow.

**Why.** Users currently have to click past Gatekeeper and SmartScreen warnings,
which trains them to ignore warnings. It also blocks distribution: **Homebrew
removes unsigned casks from its official tap from 1 September 2026**, and winget
expects signed installers.

**How.** Tauri's bundler signs and notarises when given the certificate and an
App Store Connect API key as secrets; the steps are already in the README,
unexercised. The macOS build could move into CI at the same time (it runs locally
today).

**Effort** M. **Cost** Apple Developer Program (USD 99 a year) and a Windows
signing service. **New dependencies** none.

### 5. Supply-chain checks in CI

**What.** `cargo audit` / `cargo deny` for Rust advisories and licences,
`npm audit` for the frontend, Dependabot for both and for GitHub Actions, Actions
pinned to commit SHAs, and build provenance attestations on release files.

**Why.** The app pulls hundreds of crates and npm packages; the isolation pattern
(idea 3) limits the damage, but knowing about a vulnerable dependency is the first
step. Attestations let users verify a download came from this repository's
workflow.

**Effort** S. **New dependencies** CI tools only.

---

## Reliability and platforms

### 6. Automatic updates

**What.** The app checks for a new version, shows "Update available" in Settings
and the tray, downloads it, verifies it and restarts.

**Why.** Every fix so far (the Linux tab fix in 0.0.3, for one) needs users to
find and install a new file by hand. The APT repository solves this for `.deb`
users only.

**How.** `tauri-plugin-updater`: releases are signed with a separate updater key
(generated by `tauri signer generate`; losing it means no more updates), and the
app reads a static `latest.json` listing each platform's download and signature.
Because this repository is private, `latest.json` and the files must be served
publicly — the existing `edge-notes-apt` Pages site, or a public releases
repository. On Linux the updater handles the AppImage; `.deb` installs keep using
apt.

**Effort** M. **New dependencies** `tauri-plugin-updater` (needs approval).
**Works best with** idea 4, since an unsigned macOS app replaced in place can hit
Gatekeeper again.

### 7. Automatic backups, and import

**What.** A daily snapshot of the notes database kept in the user's documents
folder (last 7 days and 4 weeks, say), "Restore from backup" in Settings, and
**import** of a previous Markdown/JSON export, which exists only one way today.

**Why.** Brief 11 promises no data loss. Soft delete with undo covers mistakes, but
not a corrupted file, a failed migration, a lost machine, or idea 2's lost key.

**How.** SQLite's online backup (`VACUUM INTO` or rusqlite's backup API) makes a
consistent copy while the app runs; restore replaces the file at startup. Import
reads `notes.json` and upserts by id, which is safe because ids are UUIDs.

**Effort** S–M. **New dependencies** none.

### 8. Close the macOS keyboard-focus gap

**What.** After the global shortcut or the tray opens the panel, typing works
straight away instead of after one click.

**Why.** It is open gap 1 in `progress.md` and undermines the shortcut's whole
point (brief 6.11: new note from anywhere).

**How.** `progress.md` records eight approaches already ruled out and the next
lead: `show_and_make_key` makes the panel's content view the first responder, not
the `WKWebView`; walking the view hierarchy and calling `makeFirstResponder:` on
the web view is untried.

**Effort** S–M. **New dependencies** none (objc2 is already present via
tauri-nspanel).

### 9. Native Wayland docking with layer-shell

**What.** On KDE Plasma, Sway, Hyprland and COSMIC, dock with the Wayland
**layer-shell** protocol instead of running under XWayland.

**Why.** The app forces XWayland because plain Wayland windows cannot position
themselves (brief 8.10). That is what exposed the Kubuntu bug fixed in 0.0.3: a
window manager adjusting an X11 window's placement. A layer-shell surface is
anchored to a screen edge by the compositor itself, which is exactly what a docked
tab is, and it can float over full-screen apps. GNOME does not support
layer-shell, so XWayland stays as the fallback.

**How.** Tauri does not expose layer-shell. It would mean reaching the GTK window
through Tauri's Linux handle and using `gtk-layer-shell`, and checking at startup
whether the compositor supports it. Note a July 2026 Tauri report: AppImage
builds forced `GDK_BACKEND=x11`, silently disabling layer-shell; fixed upstream,
but the AppImage needs checking. Brief 8.10 lists this as future work.

**Effort** L. **New dependencies** `gtk-layer-shell` bindings (needs approval).

### 10. Upgrade to Tauri 2.12 when it ships

**What.** Move from 2.11.5 once 2.12 is released.

**Why.** The fix for tauri-apps/tauri#15170 (monitor and cursor queries crashing
under load) is milestoned for 2.12; the poller currently marshals monitor queries
to the main thread as a workaround. 2.11.5 is still the newest release as of
15 Sep 2026.

**Effort** S, plus a full re-run of the dock checklists. **New dependencies** none.

### 11. Continuous integration on every push

**What.** Lint, type check and both test suites on macOS, Windows and Linux for
every push and pull request, not only at release time.

**Why.** Today a Windows- or Linux-only compile error is first seen when a release
tag is pushed (the Linux placement code in 0.0.3 was first compiled by the release
runner). CI would also run the dock tests on the platforms where docking actually
differs.

**Effort** S. **Cost** Actions minutes (macOS runners cost more on a private
repository; Linux alone covers most of it).

### 12. More install channels

**What.** winget (Windows), a Homebrew cask (after idea 4), Flathub, the AUR, and an
`.rpm` for Fedora; arm64 Linux builds for Raspberry Pi and ARM laptops.

**Why.** Each is where users on that platform look first, and each handles updates.
Tauri 2 now documents Flatpak packaging, and its bundler already builds `.rpm`.

**Effort** M overall, mostly per-channel submission and review. **Blocked by**
signing for Homebrew and, in practice, winget.

---

## Features

### 13. Real full-text search

**What.** Search that finds a word anywhere in any note, ranks the best matches
first, highlights them, and handles Chinese, Japanese and Korean text.

**Why.** Search today filters the notes already in memory with a plain substring
match: no ranking, no highlighting, and it gets slower as notes grow. Brief 14.5
lists FTS5 for this.

**How.** An SQLite FTS5 virtual table with the built-in `trigram` tokenizer
(substring matching in any language), kept in step with triggers, and a
`notes_search(query)` command returning ids, ranks and snippets. A new migration,
per the rules; no new dependency, since FTS5 is in bundled SQLite.

**Effort** M. **New dependencies** none.

### 14. Quick capture, and clipboard to note

**Built in 0.7.0** — a third panel size, two more global shortcuts, and `[ ]` for
a task. See [progress.md](progress.md) for what changed and why two of the
defaults did.

**What.** A second global shortcut opens a single-line field beside the tab: type,
press Enter, and it is saved without opening the panel. A third makes a note from
the clipboard. Both are brief 14's top items.

**Why.** Capturing a thought in two seconds is what a notes widget is for; opening
the full panel is heavier than needed. Microsoft's new Sticky Notes leads with
one-click capture for the same reason.

**How.** A small extra window or a compact panel state, reusing the dock
controller's open path; lines starting with `[ ]` could become tasks directly.
Clipboard reading needs `tauri-plugin-clipboard-manager` or a Rust clipboard crate.

**Effort** S–M. **New dependencies** a clipboard plugin (needs approval) for the
clipboard half.

### 15. Sync across devices, end-to-end encrypted

**What.** The same notes on a Mac, a Windows PC and a Linux laptop, with nothing
readable on any server.

**Why.** The most requested feature for any notes app, and brief 14.2 notes the
data model was built for it: UUID v7 ids, `updated_at` and soft-delete tombstones.

**How.** Three levels:

1. **A sync folder** the user already has (iCloud Drive, Dropbox, Syncthing): an
   encrypted change log per device, merged by id and `updated_at`. No server, no
   account.
2. **Field-level last-write-wins** over a small server, with notes encrypted on
   the device.
3. **CRDTs** (Automerge 3, Yjs, Loro, or cr-sqlite for SQLite) so concurrent edits
   to the same note merge instead of one winning. Research notes from people who
   tried this warn about history bloat and encryption friction.

**Effort** L. **New dependencies** depend on the level; all need approval.

### 16. Tags, and drag to reorder

**Built in 0.7.0** — tags parsed out of the note text, never stored; the manual
order in the `sort_order` column brief 14.4 reserved. See
[progress.md](progress.md).

**What.** `#tags` in note text become filter chips beside the colours; cards can
be dragged into a manual order.

**Why.** Colours stop scaling past a handful of topics. Brief 14.4 reserves the
`sort_order` column for manual ordering.

**How.** Tags stay plain text, parsed like task tokens (`lib/taskMeta.ts`), so
export and sync are unaffected. Reordering writes fractional `sort_order` values
so a move touches one row.

**Effort** M. **New dependencies** none.

### 17. Images and screenshots in notes

**Paste and drop built in 0.7.0.** Taking a screenshot straight into a note, and
OCR, are still open — both are per-platform work, and neither needs a dependency
decision until someone asks for them. See [progress.md](progress.md).

**What.** Paste or drop an image into a note; take a screenshot straight into a
new note. Later: search the text inside images (OCR).

**Why.** Microsoft's new Sticky Notes and BetterStickies both hold screenshots, and
it is a common way to "note" something seen on screen.

**How.** Images stored as files in the app data folder, referenced by Markdown
`![](ledge://image-id)` so notes stay plain text; a custom protocol serves
them under the CSP. OCR through the OS (Apple Vision, Windows.Media.Ocr).

**Effort** M–L. **New dependencies** likely a screenshot crate; needs approval.

### 18. Notes pinned to an app or website

**What.** Pin a note to an application, and it appears (or its tab badge lights
up) only when that app is in front — "remember to update the version" appearing
when the release tool opens.

**Why.** Zhorn Stickies' best-loved feature, and a natural fit for an edge widget
that already knows when to show itself.

**How.** A `pinnedApp` token in the note (plain text, like task tokens) and a
frontmost-app watcher in Rust (`NSWorkspace` notifications on macOS,
`GetForegroundWindow` on Windows; X11 `_NET_ACTIVE_WINDOW` on Linux). Websites
would need browser integration and are a later step.

**Effort** M–L. **New dependencies** possibly platform bindings.

### 19. Snooze a note, and calendar export for tasks

**What.** Snooze a note until a date: it leaves the list and returns with a
reminder. Tasks with dates can be exported as an `.ics` file, or subscribed to as
a calendar feed.

**Why.** Reminders and repeats exist for tasks (0.0.2); snoozing whole notes is the
next step, and seeing tasks beside meetings in a calendar is a common request.

**How.** Snooze reuses the reminder thread in `reminders.rs` and a `@snooze` token.
`.ics` generation is a small pure function over `collectTasks`.

**Effort** S–M. **New dependencies** none.

---

## Quality

### 20. Accessibility, localisation, and a diagnostics button

**What.**

- **Accessibility audit** with VoiceOver, NVDA and Orca, and a high-contrast mode
  (brief 11 asks for full keyboard operation and AA contrast; screen readers have
  never been tried).
- **Localisation**: strings are English-only and hard-coded; date labels already
  use the system locale.
- **"Copy diagnostics"** in Settings: version, platform, session type, scaling and
  the last log lines, ready to paste into a bug report. The Kubuntu report needed
  these by hand.

**Effort** M overall. **New dependencies** none for diagnostics; an i18n library
for localisation would need approval.

---

## Sources

- [Tauri 2: Updater plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri 2: Security overview](https://v2.tauri.app/security/)
- [Tauri 2: Isolation pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/)
- [Tauri: AppImage GTK hook overrides GDK_BACKEND (#15781)](https://github.com/tauri-apps/tauri/issues/15781)
- [Tauri docs: Flatpak distribution](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/flatpak.mdx)
- [rusqlite (bundled-sqlcipher features)](https://github.com/rusqlite/rusqlite)
- [keyring-rs: cross-platform credential store](https://github.com/open-source-cooperative/keyring-rs)
- [SQLite FTS5 and the trigram tokenizer](https://www.sqlite.org/fts5.html)
- [gtk-layer-shell](https://github.com/wmww/gtk-layer-shell) and
  [gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell) (supported compositors)
- [Homebrew 5.0.0: unsigned casks deprecated](https://workbrew.com/blog/homebrew-5-0-0)
- [Homebrew discussion: unsigned cask deprecation](https://github.com/orgs/Homebrew/discussions/6482)
- [Notes on CRDT-based local-first, end-to-end encrypted apps](https://kerkour.com/crdt-end-to-end-encryption-research-notes)
- [How to almost build an E2EE local-first app](https://www.zaynetro.com/post/how-to-build-e2ee-local-first-app)
- [CRDTs for mobile sync: Automerge vs Yjs vs cr-sqlite](https://mvpfactory.io/blog/crdts-for-offline-first-mobile-sync-automerge-vs-yjs-merge-semantics-and-the/)
- [SQLite Sync (CRDT replication for SQLite)](https://github.com/sqliteai/sqlite-sync)
- [Microsoft: the new Sticky Notes experience from OneNote](https://techcommunity.microsoft.com/blog/microsoft_365blog/remember-better-with-the-new-sticky-notes-experience-from-onenote/4127624)
- [Best sticky notes apps in 2026 (BetterStickies)](https://betterstickies.com/blog/best-sticky-notes-apps-2026)
- [BetterStickies vs Zhorn Stickies](https://betterstickies.com/blog/betterstickies-vs-zhorn-stickies)
- In this repository: [progress.md](progress.md) (open gaps, known issues) and
  [build-brief.md](build-brief.md) section 14 (future ideas)
