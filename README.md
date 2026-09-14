# Edge Notes

A notes widget that lives on the edge of your screen. A small tab sits against
the screen edge above whatever you are working in; point at it and a panel of
colour-coded notes slides out, move away and it slides back.

Built with Tauri 2. Rust owns the window, the database and the dock state
machine; the webview gets no window, filesystem, shell or SQL permissions.

## Running it

Node 24 is required — `.nvmrc` pins it, and Vitest 5 does not support the Node 25
that Homebrew installs.

```bash
nvm use && npm install
npm run tauri dev
```

## Versions and releases

The version lives in `package.json`; `tauri.conf.json` reads it from there, and
`npm run version:set` keeps `Cargo.toml`, `Cargo.lock` and `package-lock.json` in
step. A test fails if they ever disagree. Every release has an entry in
[CHANGELOG.md](CHANGELOG.md) and a `vX.Y.Z` tag, and its downloads are on
[GitHub Releases](https://github.com/prasenjithiwale/edge-notes/releases).

### Releasing

1. `npm run version:set -- 0.0.2`, add a `## [0.0.2]` entry to `CHANGELOG.md`,
   run the checks, commit and push.
2. Build the macOS package on a Mac (both architectures in one `.dmg`):

   ```bash
   rustup target add x86_64-apple-darwin      # once
   npm run tauri build -- --target universal-apple-darwin --bundles dmg
   ```

3. Create the release with the `.dmg`. This also creates the tag:

   ```bash
   gh release create v0.0.2 "Edge-Notes_0.0.2_macOS_universal.dmg" \
     --target master --title "Edge Notes v0.0.2" --notes-file notes.md
   ```

4. The tag starts the **Release** workflow (`.github/workflows/release.yml`), which
   tests and builds the Linux `.deb` and `.AppImage` on Ubuntu 22.04 and attaches
   them to the same release, usually within 15 minutes. It can also be re-run
   for an existing tag from the Actions tab.

Linux cannot be built on a Mac: Tauri bundles only for the platform it runs on,
and the Linux build links against WebKitGTK, so it needs a Linux machine or CI.

## Building

```bash
npm run tauri build                      # everything the current platform can make
npm run tauri build -- --bundles app     # macOS .app only, much faster
```

Artifacts land in `src-tauri/target/release/bundle/`.

Tauri builds only for the platform it runs on, so the Windows and Linux packages
have to be built on Windows and Linux (or in CI on those runners). The commands
are the same on each.

| Platform | Produces                    | Built on |
| -------- | --------------------------- | -------- |
| macOS    | `.app`, `.dmg`              | macOS    |
| Windows  | `.msi` (WiX), `.exe` (NSIS) | Windows  |
| Linux    | `.AppImage`, `.deb`         | Linux    |

### Icons

`src-tauri/icons/` is generated, not hand-made:

```bash
python3 tools/make_icons.py
```

It draws the app icon, the Windows logo set, `icon.icns`, `icon.ico` and the
monochrome menu-bar template, with no image tooling required. Edit the script
rather than the PNGs.

### Signing and notarising on macOS

Unsigned builds run locally but Gatekeeper stops them elsewhere, so a release
needs an Apple Developer ID. Tauri reads these from the environment:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"   # not your Apple ID password
export APPLE_TEAM_ID="TEAMID"
npm run tauri build
```

Tauri signs the bundle, submits it to Apple's notary service, waits for the
ticket and staples it. To check the result:

```bash
spctl -a -vvv -t install "src-tauri/target/release/bundle/macos/Edge Notes.app"
xcrun stapler validate "src-tauri/target/release/bundle/dmg/Edge Notes_0.1.0_aarch64.dmg"
```

**The Mac App Store is not an option.** Transparency needs `macOSPrivateApi`,
which the store forbids, so this is distributed directly.

## Platform notes

### macOS

Runs as an accessory app: no Dock icon and no menu bar, just the tray. The window
is converted to an `NSPanel` so it can float above full-screen apps, join every
Space, and take the keyboard when you click it without activating the app when
you merely point at it.

Requires macOS 12 or newer.

### Windows

`skipTaskbar` and `alwaysOnTop` carry most of the behaviour. Needs WebView2,
which ships with Windows 11 and recent Windows 10. Exclusive full-screen games
will cover the widget.

### Linux

X11 is supported directly. Under Wayland the app starts itself in XWayland,
because Wayland does not let an application place its own windows and GNOME
ignores always-on-top. To opt out and run natively:

```bash
EDGE_NOTES_NATIVE_WAYLAND=1 edge-notes
```

Transparency needs a compositing window manager. Some NVIDIA and WebKitGTK
combinations render a blank window; if that happens:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 edge-notes
```

## Known limitations

- **A panel opened by the shortcut or the tray takes no keystrokes until you
  click it once.** Clicking anywhere in the panel puts the caret in the note.
  This is a macOS panel-focus problem; `docs/progress.md` records the eight
  approaches already ruled out.
- **Windows and Linux are unverified.** Everything has been built and tested on
  macOS only. The platform-specific code exists and the geometry is covered by
  unit tests, but no one has run it on those systems.
- **Only one monitor's worth of scaling has been seen.** 150% and 200% scaling
  and multi-monitor placement are covered by unit tests, not by hardware.
- Notes are plain text. No markdown rendering, checklists, images, reminders,
  tags or folders.
- There is no sync. Notes live in one SQLite file on one machine, though the
  schema is built for sync later.

## Your notes

One SQLite database, in the usual application data folder:

| Platform | Path                                                       |
| -------- | ---------------------------------------------------------- |
| macOS    | `~/Library/Application Support/dev.edgenotes.app/notes.db` |
| Windows  | `%APPDATA%\dev.edgenotes.app\notes.db`                     |
| Linux    | `~/.local/share/dev.edgenotes.app/notes.db`                |

Deleting a note is a soft delete, so undo works; rows are purged for good 30 days
later. Settings → Export writes every note as Markdown plus a `notes.json`
backup into your documents folder.

## Layout

```
src/           the panel: dock/, notes/, settings/, components/, store/, lib/
src-tauri/     Rust: dock/ (geometry, state machine, poller), db/, platform/,
               commands.rs, tray.rs, export.rs
docs/          build-brief.md (the specification), progress.md (decisions,
               findings and what is still unverified)
tools/         the icon generator
```

`docs/progress.md` is the honest record: what was built, what broke, what was
measured, and the open gaps. Read it before changing anything.

## Checks

```bash
npm run lint && npx tsc --noEmit && npm test
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```
