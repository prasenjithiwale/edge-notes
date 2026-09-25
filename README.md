# Ledge

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

## Installing

Downloads live at
[prasenjithiwale.github.io/edge-notes-apt](https://prasenjithiwale.github.io/edge-notes-apt/),
which also serves the APT repository, the Homebrew cask's download and the
update feed. The same files are attached to this repository's
[Releases](https://github.com/prasenjithiwale/edge-notes/releases).

### macOS, with Homebrew

macOS 12 Monterey or later, Apple silicon and Intel in one build:

```bash
brew trust --cask prasenjithiwale/tap/edge-notes
brew install --cask prasenjithiwale/tap/edge-notes
```

Homebrew will not load a cask from a tap outside its own repositories until you
say you trust it, which is the first line; the second adds
[the tap](https://github.com/prasenjithiwale/homebrew-tap) and installs. After
that the short name works, as in `brew upgrade edge-notes`.

The cask is still called `edge-notes` although the app is Ledge: it is what an
existing install is upgraded by, and renaming the token would strand anyone who
installed before 0.1.0 on the last version they got.

The build is not signed with an Apple Developer ID and is not notarised, so macOS
will not open it while it carries the quarantine attribute that Homebrew puts on
every cask. The cask therefore strips it after installing, which is what
`--no-quarantine` did before Homebrew removed that flag in July 2026; the reasons
are written out in `tools/publish_cask.sh`. It does mean the app is installed
without a Gatekeeper check. The `.dmg` is on the site too, for installing by
hand — after which the quarantine attribute has to come off by hand as well:

```bash
xattr -dr com.apple.quarantine "/Applications/Ledge.app"
```

### Windows

The page has the latest `setup.exe` and `.msi` for 64-bit Windows 10 and 11, with
their SHA-256 sums. The builds are not code-signed, so SmartScreen warns the first
time: **More info**, then **Run anyway**.

### Debian and Ubuntu, with apt

The same site is a signed APT repository, so on x86_64 Ubuntu 22.04+ or Debian
12+ Ledge installs and updates like any other package:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://prasenjithiwale.github.io/edge-notes-apt/key.gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/ledge.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/ledge.gpg] https://prasenjithiwale.github.io/edge-notes-apt stable main" \
  | sudo tee /etc/apt/sources.list.d/ledge.list
sudo apt update
sudo apt install ledge
```

The app was called Edge Notes until 0.1.0 and its package was `edge-notes`. If
that one is installed, `sudo apt install ledge` replaces it: the new package
declares `Replaces`, `Conflicts` and `Provides` on the old name, so apt takes the
old one out rather than leaving two copies of the same app installed. (A plain
`apt upgrade` will not do it on its own — nothing depends on either package, so
apt has no reason to make the swap unasked.) The notes come across on first
launch; see "Upgrading from Edge Notes" below.

## Upgrading from Edge Notes

0.1.0 renamed the app, and with it the bundle identifier
(`dev.edgenotes.app` → `dev.ledge.app`). That identifier is what the app-data
folder is named after, so the first launch of Ledge copies `notes.db` from the
old folder into the new one — notes, tasks and settings all come across. The old
folder is left where it is, untouched, so an older build still opens on its own
data and a failed copy costs nothing. Once you are happy, it can be deleted:

- macOS: `~/Library/Application Support/dev.edgenotes.app`
- Windows: `%APPDATA%\dev.edgenotes.app`
- Linux: `~/.local/share/dev.edgenotes.app`

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
   # rustup's cargo must come first: a Homebrew Rust earlier on PATH has no
   # Intel target and fails with "can't find crate for `core`".
   # The updater key signs the archive installed copies update from (idea 6).
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/ledge-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   PATH="$HOME/.cargo/bin:$PATH" npm run tauri build -- --target universal-apple-darwin --bundles app,dmg \
     --config '{"bundle":{"createUpdaterArtifacts":true}}'
   ```

   Rename the updater archive beside the `.dmg`:

   ```bash
   out=src-tauri/target/universal-apple-darwin/release/bundle/macos
   cp "$out/Ledge.app.tar.gz" Ledge_0.0.2_macOS_universal.app.tar.gz
   cp "$out/Ledge.app.tar.gz.sig" Ledge_0.0.2_macOS_universal.app.tar.gz.sig
   ```

3. Create the release with the `.dmg`. This also creates the tag:

   ```bash
   gh release create v0.0.2 "Ledge_0.0.2_macOS_universal.dmg" \
     Ledge_0.0.2_macOS_universal.app.tar.gz* \
     --target master --title "Ledge v0.0.2" --notes-file notes.md
   ```

4. The tag starts the **Release** workflow (`.github/workflows/release.yml`), which
   tests and builds the Linux `.deb` and `.AppImage` on Ubuntu 22.04 and the
   Windows `setup.exe` and `.msi` on Windows, and attaches them to the same
   release, usually within 20 minutes.

   Its **Pages site** job then publishes all three to `edge-notes-apt`: the
   `.deb` into the APT repository, re-signed, the Windows installers into
   `windows/` and the macOS `.dmg` into `macos/`, each with a `SHA256SUMS` file.
   It then writes the Homebrew cask into
   [`prasenjithiwale/homebrew-tap`](https://github.com/prasenjithiwale/homebrew-tap),
   pinning the sha256 of the `.dmg` it just published — after the site push,
   never before it, or the cask would advertise a download that is not there. It rewrites the landing page from what
   is in the site, so the versions and sizes it shows are always the published
   ones. Old versions of both are kept. Finally it checks the live site: it
   installs the `.deb` from the repository on Ubuntu 24.04 and downloads the
   Windows installers, comparing them with the published sums. A release is only
   green if both work.

   It can also be run from the Actions tab for an existing tag and a chosen
   platform (`gh workflow run release.yml -f tag=v0.0.2 -f platforms=windows`, or
   `platforms=publish` to publish an existing release's packages).

The platform builds need `TAURI_SIGNING_PRIVATE_KEY`: the contents of
`~/.tauri/ledge-updater.key`, which signs every file an installed copy may update
itself from. **Lose it and no installed copy can be updated again**; keep a
backup away from this Mac. The Pages job writes `updates/latest.json`, the feed
the app reads, with `tools/publish_updates.sh`.

The Pages job needs three repository secrets: `APT_SIGNING_KEY` (the armored
private key that signs the APT repository), `APT_DEPLOY_KEY` (an SSH deploy key
with write access to `edge-notes-apt`) and `HOMEBREW_TAP_DEPLOY_KEY` (the same,
for `homebrew-tap`).

The macOS `.dmg` is the one package built by hand, so a release made without
step 2 simply has no `.dmg`: the job says so and leaves the site's and the cask's
existing version alone rather than failing.

Neither Linux nor Windows can be built on a Mac: Tauri bundles only for the
platform it runs on, so each needs its own machine or a CI runner.

### The keychain, while developing

A dev build is a freshly signed binary every time it rebuilds, and the keychain
treats each one as a stranger — so it asks for access to the database key on
every restart, and a prompt left unanswered leaves the panel showing the locked
view.

`LEDGE_DB_KEY` supplies the key instead, and **debug builds only**:

```bash
# The key, once, from the running app: Settings › Privacy › Reveal — or from
# the keychain directly, which asks for permission once:
security find-generic-password -s dev.ledge.app -a notes.db -w

# Then, for a dev session that never asks again:
LEDGE_DB_KEY="<that key>" npm run tauri dev
```

Spaces and dashes are ignored, so the key can be pasted as it is displayed.
Unset the variable and the keychain is used exactly as before — nothing else
changes, and the database stays encrypted either way.

An environment variable is a worse place for a key than the keychain: it is
inherited by every child process and visible in a process listing. That is why a
release build ignores it, and why this is for a development machine rather than
for daily use.

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

`tauri.conf.json` sets `"signingIdentity": "-"`, which ad-hoc signs the bundle.
That costs nothing and needs no account, and it is worth having: without it only
the executable carries the linker's own signature, the bundle is unsealed and its
identity is a generated string rather than `dev.edgenotes.app` — which is the
identity macOS remembers a notification permission against.

Ad-hoc is not a Developer ID, though: Gatekeeper still rejects the app, which is
why the Homebrew cask strips the quarantine attribute. Releasing an app that
passes Gatekeeper needs a real identity. Tauri reads these from the environment:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"   # not your Apple ID password
export APPLE_TEAM_ID="TEAMID"
npm run tauri build
```

Tauri signs the bundle, submits it to Apple's notary service, waits for the
ticket and staples it. Doing that would let the cask's `postflight_steps` go.
To check the result:

```bash
spctl -a -vvv -t install "src-tauri/target/release/bundle/macos/Ledge.app"
xcrun stapler validate "src-tauri/target/release/bundle/dmg/Ledge_0.1.0_aarch64.dmg"
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
LEDGE_NATIVE_WAYLAND=1 ledge
```

Transparency needs a compositing window manager. Some NVIDIA and WebKitGTK
combinations render a blank window; if that happens:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ledge
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
- No images, tags or folders. (Markdown, checklists, tasks with dates and
  repeats, reminders and a focus timer all arrived after this list was written.)
- There is no sync. Notes live in one SQLite file on one machine, though the
  schema is built for sync later.

## Your notes

One SQLite database, in the usual application data folder:

| Platform | Path                                                  |
| -------- | ----------------------------------------------------- |
| macOS    | `~/Library/Application Support/dev.ledge.app/notes.db` |
| Windows  | `%APPDATA%\dev.ledge.app\notes.db`                     |
| Linux    | `~/.local/share/dev.ledge.app/notes.db`                |

From 0.6.0 that file is **encrypted** — SQLCipher, AES-256, schema included —
with the key in the macOS Keychain, Windows Credential Manager or the Linux
Secret Service. An existing database is converted the first time 0.6.0 opens it.
Settings → Privacy shows the key as a recovery key: keep it somewhere, because a
lost keychain with no copy of the key means notes nobody can read, this app
included. Where a system has no credential store at all, the notes stay in the
clear and Settings says so rather than pretending otherwise.

Deleting a note is a soft delete, so undo works; rows are purged for good 30 days
later. Settings → Export writes every note as Markdown plus a `notes.json`
backup into your documents folder — in the clear, by design, because an export
you cannot open is not a backup.

## Layout

```
src/           the panel: dock/, notes/, settings/, components/, store/, lib/
src-tauri/     Rust: dock/ (geometry, state machine, poller), db/, platform/,
               commands.rs, tray.rs, export.rs
docs/          build-brief.md (the specification), progress.md (decisions,
               findings and what is still unverified)
tools/         icon artwork and scripts, release and site publishing
```

`docs/progress.md` is the honest record: what was built, what broke, what was
measured, and the open gaps. Read it before changing anything.

## Checks

```bash
npm run lint && npx tsc --noEmit && npm test
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

## Licence and contributions

Ledge is [MIT licensed](LICENSE). The calligraphy face, Pinyon Script, is under the
SIL Open Font License (`src/assets/fonts/OFL.txt`).

It is open source and not open to contributions: pull requests and feature
requests are not taken. [Bug reports](https://github.com/prasenjithiwale/edge-notes/issues)
are welcome; say which version and system (Settings › About › Copy).

## Code signing and privacy

Windows releases are to be signed through the
[SignPath Foundation](https://signpath.org) programme for open-source projects;
the policy, who approves each release, and what the app sends over the network
are on the [download page](https://prasenjithiwale.github.io/edge-notes-apt/#signing).
