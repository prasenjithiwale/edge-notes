#!/usr/bin/env bash
# Write the landing page of the Ledge Pages site.
#
#   tools/render_site.sh <pages repository checkout>
#
# Run by the Release workflow after publish_apt.sh, publish_macos.sh and
# publish_windows.sh, so the page describes what is actually published: the
# versions, file names and sizes all come from the checkout, never from an
# argument that could disagree with it.
#
# The screenshots are the other half of the page and they come from this
# repository instead — `site/screenshots/` beside this script — because they are
# pictures of the app, not of the release. They are copied into the site on every
# run, so replacing one here republishes it.
#
# The page is generated. An edit made by hand in the site repository is
# overwritten by the next release; change this script instead.
set -euo pipefail
shopt -s nullglob

repo=$1
site=https://prasenjithiwale.github.io/edge-notes-apt
# Every link on the page has to be one a visitor can actually open. The source
# repository is private, so the public one this site is served from is where bug
# reports go, and the changelog is published here rather than linked into a
# repository nobody outside can read.
issues=https://github.com/prasenjithiwale/edge-notes-apt/issues
source_dir=$(cd "$(dirname "$0")/.." && pwd)

# Every published file is named <product>_<version>_<platform>..., so one rule
# reads the version off any of them.
version_of() { basename "$1" | cut -d_ -f2; }
size_of() { awk -v b="$(wc -c < "$1")" 'BEGIN { printf "%.1f MB", b / 1048576 }'; }

# Sets REPLY to the version-newest of its arguments, or to nothing when a glob
# matched nothing (nullglob passes no arguments at all, which is how a site with
# no Windows installers yet still renders).
#
# Sorted on the version pulled out of each name, not on the path: the Debian
# packages come from two pool directories now (the package was renamed in 0.1.0)
# and sorting whole paths would rank them by directory.
pick_newest() {
  REPLY=
  if [ "$#" -gt 0 ]; then
    REPLY=$(for file in "$@"; do printf '%s\t%s\n' "$(version_of "$file")" "$file"; done |
      sort -V -k1,1 | tail -1 | cut -f2-)
  fi
}

# Both pool directories: the package was `edge-notes` up to 0.0.4 and `ledge`
# from 0.1.0, and the page should show the newest of either rather than go blank
# the moment the name changed.
pick_newest "$repo"/pool/main/l/ledge/*.deb "$repo"/pool/main/e/edge-notes/*.deb; deb=$REPLY
deb_package=
[ -n "$deb" ] && deb_package=$(basename "$deb" | cut -d_ -f1)
pick_newest "$repo"/macos/*.dmg; dmg=$REPLY
pick_newest "$repo"/windows/*-setup.exe; setup=$REPLY

# The .msi is paired with that .exe by version rather than picked on its own, so
# a half-published release cannot put two different versions side by side.
msi=
if [ -n "$setup" ]; then
  pick_newest "$repo"/windows/*_"$(version_of "$setup")"_*.msi
  msi=$REPLY
fi

# Off the key that is actually published, so rotating it needs no edit here.
fingerprint=
if [ -f "$repo/key.gpg" ]; then
  fingerprint=$(gpg --show-keys --with-colons "$repo/key.gpg" |
    awk -F: '/^fpr/ { print $10; exit }')
fi

# The newest version of anything published, for the header. A site mid-release
# can hold three different ones; the highest is the one to name.
version=$(for file in "$deb" "$dmg" "$setup"; do
  [ -n "$file" ] && version_of "$file"
done | sort -V | tail -1)
[ -z "$version" ] && version="—"

# The screenshots travel with the page rather than with the packages.
screenshots=$source_dir/site/screenshots
if [ -d "$screenshots" ]; then
  mkdir -p "$repo/screenshots"
  cp "$screenshots"/*.png "$repo/screenshots/"
fi

# The app's own icon, straight from the bundle's, so the tab and the wordmark
# show what the Dock and the Start menu show.
[ -f "$source_dir/src-tauri/icons/128x128.png" ] &&
  cp "$source_dir/src-tauri/icons/128x128.png" "$repo/icon.png"

# A screenshot is only put on the page if it is actually there: the site should
# never show a broken image because a file was renamed here.
shot() { [ -f "$repo/screenshots/$1" ]; }

macos_section=
if [ -n "$dmg" ]; then
  macos_section=$(cat <<HTML

    <article class="platform" id="macos">
      <header class="platform-head">
        <h3>macOS</h3>
        <p class="meta">Version $(version_of "$dmg") &middot; macOS 12 Monterey or later &middot; Apple silicon and Intel in one build</p>
      </header>
      <p>Homebrew is the easier route, and brings new versions with
      <code>brew upgrade</code>:</p>
<pre><code>brew trust --cask prasenjithiwale/tap/edge-notes
brew install --cask prasenjithiwale/tap/edge-notes</code></pre>
      <p>Homebrew will not load a cask from a tap outside its own repositories
      until you say you trust it, which is what the first line is; the second adds
      the tap and installs. Afterwards it is just <code>edge-notes</code>, as in
      <code>brew upgrade edge-notes</code>.</p>
      <p>Or take the disk image and drag the app to Applications:</p>
      <p class="downloads">
        <a class="download" href="$site/macos/$(basename "$dmg")">
          <span class="download-label">Disk image (.dmg)</span>
          <span class="download-meta">$(size_of "$dmg")</span>
        </a>
      </p>
      <div class="note">
        <p><b>Gatekeeper.</b> These builds are not signed with an Apple Developer
        ID and are not notarised, so macOS will not open the app while it carries
        the quarantine flag that anything downloaded gets. The Homebrew cask
        removes that flag for you — which also means the app is installed without
        a Gatekeeper check, so install it only if you trust this site. After the
        <code>.dmg</code>, do it yourself once:</p>
<pre><code>xattr -dr com.apple.quarantine "/Applications/Ledge.app"</code></pre>
      </div>
      <p class="fine">Check a download against
      <a href="$site/macos/SHA256SUMS">SHA256SUMS</a> with <code>shasum -a 256</code>.
      To remove the app: <code>brew uninstall --cask edge-notes</code>, or drag it
      to the Bin.</p>
    </article>
HTML
)
fi

windows_section=
if [ -n "$setup" ] && [ -n "$msi" ]; then
  windows_section=$(cat <<HTML

    <article class="platform" id="windows">
      <header class="platform-head">
        <h3>Windows</h3>
        <p class="meta">Version $(version_of "$setup") &middot; Windows 10 and 11 &middot; 64-bit</p>
      </header>
      <p class="downloads">
        <a class="download" href="$site/windows/$(basename "$setup")">
          <span class="download-label">Installer (.exe)</span>
          <span class="download-meta">$(size_of "$setup")</span>
        </a>
        <a class="download" href="$site/windows/$(basename "$msi")">
          <span class="download-label">Package (.msi)</span>
          <span class="download-meta">$(size_of "$msi")</span>
        </a>
      </p>
      <p>The installer is the usual choice; the <code>.msi</code> is there for
      deploying it across a fleet. Both install the same app, and fetch the
      WebView2 runtime if Windows does not already have it.</p>
      <div class="note">
        <p><b>SmartScreen.</b> These builds are not code-signed, so Windows warns
        the first time: choose <b>More info</b>, then <b>Run anyway</b>.</p>
      </div>
      <p class="fine">Check a download against
      <a href="$site/windows/SHA256SUMS">SHA256SUMS</a> with
      <code>Get-FileHash</code> in PowerShell.</p>
    </article>
HTML
)
fi

linux_section=
if [ -n "$deb" ]; then
  linux_section=$(cat <<HTML

    <article class="platform" id="linux">
      <header class="platform-head">
        <h3>Debian and Ubuntu</h3>
        <p class="meta">Version $(version_of "$deb") &middot; Debian 12+, Ubuntu 22.04+, Kubuntu and derivatives &middot; x86_64</p>
      </header>
      <p>This page is also a signed APT repository, so new versions arrive with
      <code>sudo apt update &amp;&amp; sudo apt upgrade</code> like anything else
      on the system:</p>
<pre><code>sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL $site/key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/ledge.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/ledge.gpg] $site stable main" \\
  | sudo tee /etc/apt/sources.list.d/ledge.list
sudo apt update
sudo apt install $deb_package</code></pre>
      <p>The app was called Edge Notes until 0.1.0 and its package was
      <code>edge-notes</code>. If you installed that one, the line above replaces
      it: <code>ledge</code> declares <code>Replaces</code> and
      <code>Conflicts</code> on the old name, so apt takes it out rather than
      leaving both installed. Your notes come across on first launch.</p>
      <p class="fine">To remove it:
      <code>sudo apt remove $deb_package</code>, then
      <code>sudo rm /etc/apt/sources.list.d/ledge.list /etc/apt/keyrings/ledge.gpg</code>.
      On Wayland the app runs through XWayland; <code>LEDGE_NATIVE_WAYLAND=1</code>
      opts out of that.</p>
    </article>
HTML
)
fi

key_section=
if [ -n "$deb" ] && [ -n "$fingerprint" ]; then
  key_section=$(cat <<HTML

    <p class="fine key">The APT repository is signed by &quot;Edge Notes APT
    repository&quot; (named before the app was), RSA 4096, fingerprint
    <code>$fingerprint</code>.</p>
HTML
)
fi

# Each section opens with a blank line and lost its closing newline to command
# substitution; putting that back is all the joining these need.
platforms=
for section in "$macos_section" "$windows_section" "$linux_section"; do
  if [ -n "$section" ]; then
    platforms+="$section"$'\n'
  fi
done
platforms=${platforms%$'\n'}

hero_figure=
if shot hero.png; then
  hero_figure=$(cat <<HTML
  <figure class="hero-shot">
    <img src="screenshots/hero.png" width="1920" height="840" alt="The Ledge panel open on the right-hand edge of a screen, over a document, showing four colour-coded notes." loading="eager">
  </figure>
HTML
)
fi

# One feature block. \$1 image, \$2 alt, \$3 heading, \$4 body, \$5 "wide" for the
# larger screenshots. Kept as a function because the page has seven of them and
# the only thing that changes is the words.
feature() {
  local image=$1 alt=$2 heading=$3 body=$4 modifier=${5-}
  local figure=
  if shot "$image"; then
    figure="<figure class=\"shot $modifier\"><img src=\"screenshots/$image\" alt=\"$alt\" loading=\"lazy\"></figure>"
  fi
  cat <<HTML

    <section class="feature $modifier">
      <div class="feature-text">
        <h3>$heading</h3>
        $body
      </div>
      $figure
    </section>
HTML
}

features=$(
  feature notes.png \
    "The Notes tab: coloured cards with checkboxes, code and bold text." \
    "Notes, where you left them" \
    "<p>Every note is a card in one column, in the colour you gave it — sixteen of
     them, plus none at all. The newest sits at the top unless you lock it, and a
     locked note stays put and opens read-only. The dots under the tabs filter the
     list by colour, and <kbd>&#8984;F</kbd> searches it.</p>
     <p>Deleting is undoable: a note goes to a toast with an <b>Undo</b> in it, and
     is kept for thirty days after that.</p>"

  feature expanded.png \
    "A note expanded to fill a large panel, with checkboxes, a numbered list and a shell code block." \
    "Write in rich text; keep plain Markdown" \
    "<p>The editor is rich text — bold with <kbd>&#8984;B</kbd>, lists with
     <kbd>&#8984;&#8679;8</kbd>, or type <kbd>/</kbd> for a menu of blocks. What is
     stored is still Markdown, byte for byte, so a note is a file you could have
     written by hand.</p>
     <p>Code goes in a fenced block with a language of its own and syntax colour for
     sixteen of them. Need room? Expand the note and the panel itself grows.</p>" \
    wide

  feature tasks.png \
    "The Tasks tab, with an In progress section at the top, then Today, Tomorrow, Upcoming, Someday, Done and Cancelled." \
    "Tasks that know what day it is" \
    "<p>Tasks are their own list, not checkboxes buried in a note: In progress at
     the top, then Today, Tomorrow, Upcoming and Someday, with Done and Cancelled
     folded away at the bottom.</p>
     <p>Type the details straight into the add field — <code>@tomorrow</code>,
     <code>2pm</code>, <code>!high</code> — and see them read back as chips before
     you press Return.</p>"

  feature task-details.png \
    "A task's details: status, priority, due date and time, repeat, notes, and a Focus on this button." \
    "Four statuses, not one tick" \
    "<p>A task is <b>Open</b>, <b>In progress</b>, <b>Done</b> or <b>Cancelled</b>.
     The box in the row still finishes one in a press — that is the thing you do
     all day — and the sheet is where a task is started or dropped. Something you
     decided against is closed without being counted as work you did.</p>
     <p>Underneath: priority, a due date and time, and a repeat that moves the
     task on when you tick it rather than completing it. Anything due can raise a
     system notification, and a task can be handed straight to the focus timer.</p>"

  feature focus.png \
    "The Focus tab with a pomodoro timer running at 24:35, working on the task Cut 0.4.0." \
    "A focus timer that survives being ignored" \
    "<p>A pomodoro with your own lengths, a long break every so often, and a
     count of what you finished today. Point it at a task and the session has a
     name.</p>
     <p>It keeps an end time rather than counting down, so a session that ran out
     while the panel was closed and the machine asleep still ends when it should —
     and a small light on the tab tells you it is running without opening
     anything.</p>"

  feature settings.png \
    "Settings, showing theme, tab appearance, tab size, panel translucency and the docked edge." \
    "It goes where you want it" \
    "<p>Left edge or right, on whichever monitor, opening on hover or on a click.
     The tab comes in three sizes and two finishes, the panel in whatever width
     suits you, and there is a <b>Keep open</b> pin for when it should stop sliding
     away.</p>
     <p>Light, dark, or whatever the system is doing. A tray icon and a global
     shortcut — <kbd>&#8984;&#8997;N</kbd> by default — open it with a new note
     ready.</p>"

  feature dark.png \
    "The same notes in dark mode." \
    "Dark, too" \
    "<p>Every colour in the palette has a dark counterpart, checked against WCAG
     AA contrast by a test rather than by eye. The chrome stays neutral; the notes
     are the only colour on screen.</p>"
)

# The stylesheet is a file rather than a <style> block now: there are two pages
# and they must not drift. The dark palette appears twice inside it, which is why
# it is a variable — see the comment beside it.
dark_tokens='    --bg: #131315;
    --bg-soft: #1b1b1e;
    --card: #1c1c1f;
    --fg: #f2f2f3;
    --muted: #a1a1a6;
    --faint: #8a8a8f;
    --code: #232327;
    --border: rgba(255, 255, 255, .11);
    --hairline: rgba(255, 255, 255, .07);
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 18px 48px rgba(0,0,0,.55);
    --shadow-soft: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35);
    --accent: #6f9bff;'

cat > "$repo/style.css" <<CSS
  :root {
    color-scheme: light dark;
    --bg: #fff;
    --bg-soft: #f5f5f7;
    --card: #fff;
    --fg: #1d1d1f;
    --muted: #6e6e73;
    --faint: #86868b;
    --code: #f4f4f5;
    --border: rgba(0, 0, 0, .09);
    --hairline: rgba(0, 0, 0, .06);
    --shadow: 0 1px 2px rgba(0,0,0,.05), 0 12px 36px rgba(0,0,0,.10);
    --shadow-soft: 0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.06);
    --accent: #2f6df6;
  }
  /* Dark, twice: for a system that asks for it where the reader has not chosen,
     and for a reader who has. The :not() is what lets a stored "light" win over
     the system — a switch that only worked one way would not be a switch. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
$dark_tokens
    }
  }
  :root[data-theme="dark"] {
$dark_tokens
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Ubuntu, Cantarell, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  img { max-width: 100%; height: auto; display: block; }
  a { color: inherit; }
  code, kbd, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  code { font-size: .92em; background: var(--code); border-radius: 5px; padding: .1em .35em; }
  pre {
    background: var(--code);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    padding: 14px 16px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.65;
  }
  pre code { background: none; padding: 0; font-size: inherit; }
  kbd {
    font-size: .82em;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 6px;
    padding: .1em .4em;
    background: var(--card);
    white-space: nowrap;
  }
  .wrap { max-width: 1020px; margin: 0 auto; padding: 0 24px; }
  .narrow { max-width: 760px; }

  /* Header */
  header.top {
    position: sticky; top: 0; z-index: 10;
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    border-bottom: 1px solid var(--hairline);
  }
  .top-inner { display: flex; align-items: center; gap: 20px; height: 54px; }
  .wordmark { font-weight: 600; letter-spacing: -.01em; text-decoration: none; display: flex; align-items: center; gap: 9px; }
  .mark { width: 20px; height: 20px; border-radius: 5px; }
  .top nav { margin-left: auto; display: flex; gap: 22px; font-size: 14px; }
  .top nav a { color: var(--muted); text-decoration: none; }
  .top nav a:hover { color: var(--fg); }

  /* Hero */
  .hero { padding: 76px 0 8px; text-align: center; }
  .app-icon { width: 78px; height: 78px; border-radius: 18px; margin: 0 auto 22px; box-shadow: var(--shadow-soft); }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--muted);
    border: 1px solid var(--border); border-radius: 999px;
    padding: 5px 13px; margin-bottom: 22px;
  }
  h1 {
    font-size: clamp(34px, 6vw, 56px); line-height: 1.07; letter-spacing: -.028em;
    font-weight: 600; margin: 0 0 18px;
  }
  .lede { font-size: clamp(17px, 2.3vw, 21px); color: var(--muted); margin: 0 auto; max-width: 640px; }
  .cta { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 30px 0 10px; }
  .button {
    display: inline-block; text-decoration: none; font-weight: 600; font-size: 15px;
    padding: 11px 20px; border-radius: 12px;
    background: var(--fg); color: var(--bg); border: 1px solid transparent;
  }
  .button.secondary { background: transparent; color: var(--fg); border-color: var(--border); }
  .button:hover { opacity: .88; }
  .under-cta { font-size: 13px; color: var(--faint); margin: 12px 0 0; }
  .hero-shot { margin: 44px 0 0; }
  .hero-shot img {
    border-radius: 16px; border: 1px solid var(--border); box-shadow: var(--shadow);
  }

  /* Bands */
  section.band { padding: 76px 0; }
  section.band.soft { background: var(--bg-soft); border-block: 1px solid var(--hairline); }
  h2 {
    font-size: clamp(26px, 3.6vw, 34px); line-height: 1.15; letter-spacing: -.02em;
    font-weight: 600; margin: 0 0 12px;
  }
  .band > .wrap > p.sub { color: var(--muted); margin: 0 0 40px; max-width: 620px; font-size: 17px; }
  h3 { font-size: 20px; letter-spacing: -.012em; font-weight: 600; margin: 0 0 10px; }
  p { margin: 0 0 12px; }
  .feature-text p, .card p { color: var(--muted); }

  /* Three-up */
  .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .card {
    background: var(--card); border: 1px solid var(--hairline); border-radius: 16px;
    padding: 24px; box-shadow: var(--shadow-soft);
  }
  .card p:last-child { margin-bottom: 0; }

  /* Features */
  .feature {
    display: grid; grid-template-columns: 1fr 392px; gap: 56px; align-items: center;
    padding: 46px 0; border-top: 1px solid var(--hairline);
  }
  .feature:first-of-type { border-top: 0; padding-top: 8px; }
  .feature.wide { grid-template-columns: 1fr 520px; }
  .feature:nth-of-type(even) .feature-text { order: 2; }
  .feature-text p:last-child { margin-bottom: 0; }
  .shot img {
    border-radius: 14px; border: 1px solid var(--border); box-shadow: var(--shadow);
    width: 100%;
  }

  /* Keys */
  .keys { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 44px; }
  .key-row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
    padding: 11px 0; border-bottom: 1px solid var(--hairline);
  }
  .key-row span { color: var(--muted); font-size: 15px; }

  /* Downloads */
  .platform { padding: 34px 0; border-top: 1px solid var(--hairline); }
  .platform:first-of-type { border-top: 0; }
  .platform-head { margin-bottom: 14px; }
  .platform-head h3 { margin-bottom: 2px; }
  .meta { color: var(--faint); font-size: 14px; margin: 0; }
  .platform p { color: var(--muted); max-width: 660px; }
  .downloads { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  .download {
    display: flex; flex-direction: column; gap: 2px;
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 11px 16px; text-decoration: none; box-shadow: var(--shadow-soft);
  }
  .download:hover { border-color: var(--faint); }
  .download-label { font-weight: 600; font-size: 15px; }
  .download-meta { font-size: 12px; color: var(--faint); }
  .note {
    background: var(--bg-soft); border: 1px solid var(--hairline);
    border-radius: 12px; padding: 16px 18px; margin: 16px 0; max-width: 660px;
  }
  .note p:last-child { margin-bottom: 0; }
  .fine { font-size: 14px; color: var(--faint); }
  .fine code { font-size: .9em; }
  .key { margin-top: 28px; }

  /* Footer */
  footer { border-top: 1px solid var(--hairline); padding: 40px 0 56px; color: var(--faint); font-size: 14px; }
  footer a { color: var(--muted); }
  .foot-row { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: baseline; }
  .foot-row .spacer { margin-left: auto; }

  @media (max-width: 900px) {
    .trio { grid-template-columns: 1fr; }
    .feature, .feature.wide { grid-template-columns: 1fr; gap: 26px; padding: 34px 0; }
    .feature:nth-of-type(even) .feature-text { order: 0; }
    .shot { max-width: 392px; }
    .feature.wide .shot { max-width: 520px; }
    .keys { grid-template-columns: 1fr; }
    .hero { padding-top: 56px; }
    section.band { padding: 56px 0; }
    .top nav a.hide-sm { display: none; }
  }

  /* The theme switch. One button with both glyphs in it, each shown by the same
     rules that pick the palette, so the icon can never disagree with the page:
     a sun to go light while it is dark, a moon to go dark while it is light. */
  .theme {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0;
    border: 1px solid var(--border); border-radius: 9px;
    background: transparent; color: var(--muted); cursor: pointer;
  }
  .theme:hover { color: var(--fg); border-color: var(--faint); }
  .theme svg { width: 15px; height: 15px; }
  .theme .sun { display: none; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .theme .sun { display: block; }
    :root:not([data-theme="light"]) .theme .moon { display: none; }
  }
  :root[data-theme="dark"] .theme .sun { display: block; }
  :root[data-theme="dark"] .theme .moon { display: none; }
  :root[data-theme="light"] .theme .sun { display: none; }
  :root[data-theme="light"] .theme .moon { display: block; }

  /* The changelog page: one column of prose, generated from CHANGELOG.md. */
  .prose { padding: 56px 0 72px; }
  .prose h2 {
    margin: 48px 0 6px; padding-top: 24px; border-top: 1px solid var(--hairline);
    font-size: 24px;
  }
  .prose h2:first-of-type { margin-top: 8px; padding-top: 0; border-top: 0; }
  .prose .when { color: var(--faint); font-size: 14px; margin: 0 0 18px; }
  .prose h3 {
    margin: 26px 0 8px; font-size: 13px; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase; color: var(--faint);
  }
  .prose p, .prose li { color: var(--muted); }
  .prose ul { margin: 0 0 14px; padding-left: 20px; }
  .prose li { margin-bottom: 8px; }
  .prose li b, .prose p b { color: var(--fg); }
  .prose .lede { font-size: 17px; }
CSS

# Shared by both pages: the switch's markup, and the script that remembers it.
theme_button='<button type="button" class="theme" data-theme-toggle aria-label="Switch between light and dark">
      <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    </button>'
theme_script='<script>
  // Set before anything paints, so a reader who chose light never sees a dark
  // frame first. Wrapped because storage can throw in a private window, and a
  // page that will not render is worse than a page that forgot a preference.
  (function () {
    var root = document.documentElement;
    var KEY = "ledge-theme";
    try {
      var stored = localStorage.getItem(KEY);
      if (stored === "light" || stored === "dark") { root.setAttribute("data-theme", stored); }
    } catch (error) { /* no storage: the system decides */ }
    document.addEventListener("click", function (event) {
      var target = event.target;
      var button = target && target.closest ? target.closest("[data-theme-toggle]") : null;
      if (!button) { return; }
      var chosen = root.getAttribute("data-theme");
      var dark = chosen === "dark" ||
        (chosen === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (error) { /* as above */ }
    });
  })();
</script>'

# The header, for whichever page is being written. Both pages sit at the root, so
# only the section anchors differ: in-page on the landing page, and a link back to
# it from anywhere else. Everything else is written once and cannot drift.
nav_for() {
  cat <<NAV
<header class="top">
  <div class="wrap top-inner">
    <a class="wordmark" href="./"><img class="mark" src="icon.png" width="20" height="20" alt=""> Ledge</a>
    <nav>
      <a href="$1#features">Features</a>
      <a href="$1#keys" class="hide-sm">Shortcuts</a>
      <a href="$1#download">Download</a>
      <a href="changelog.html">Changelog</a>
      $theme_button
    </nav>
  </div>
</header>
NAV
}

nav_html=$(nav_for "")

cat > "$repo/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ledge — notes on the edge of your screen</title>
<meta name="description" content="Ledge is a small notes, tasks and focus widget docked to the edge of your screen. Free, local-only, for macOS, Windows, Debian and Ubuntu.">
<meta property="og:title" content="Ledge — notes on the edge of your screen">
<meta property="og:description" content="Point at the tab and a panel of colour-coded notes slides out; move away and it slides back. Free, local-only, for macOS, Windows and Linux.">
<meta property="og:type" content="website">
<meta property="og:url" content="$site/">
<meta property="og:image" content="$site/screenshots/hero.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="icon.png" sizes="128x128" type="image/png">
<link rel="apple-touch-icon" href="icon.png">
<link rel="stylesheet" href="style.css">
$theme_script

</head>
<body>

$nav_html

<main id="top">

<div class="hero wrap">
  <img class="app-icon" src="icon.png" width="78" height="78" alt="">
  <span class="eyebrow">Version $version &middot; macOS, Windows, Linux</span>
  <h1>Notes on the edge<br>of your screen.</h1>
  <p class="lede">A small tab sits against the screen edge, above whatever you are
  working in. Point at it and a panel of colour-coded notes slides out. Move away
  and it slides back.</p>
  <p class="cta">
    <a class="button" href="#download">Download for free</a>
    <a class="button secondary" href="#features">See what it does</a>
  </p>
  <p class="under-cta">No account, no sync, no telemetry. Your notes are a SQLite file on your own disk.</p>
$hero_figure
</div>

<section class="band">
  <div class="wrap">
    <div class="trio">
      <div class="card">
        <h3>Always within reach</h3>
        <p>It floats above other windows and follows you across desktops and
        full-screen apps, so it is one small movement away — not a window to find,
        raise and put back.</p>
      </div>
      <div class="card">
        <h3>Never in the way</h3>
        <p>Collapsed, it is a pill at the edge. Opening it takes no focus from what
        you are typing in, and it slides away by itself the moment you leave.</p>
      </div>
      <div class="card">
        <h3>Yours, on your disk</h3>
        <p>Notes are Markdown in a local database, and can be exported as plain
        files whenever you like. The app asks the network for nothing.</p>
      </div>
    </div>
  </div>
</section>

<section class="band soft" id="features">
  <div class="wrap">
    <h2>Three tabs, one panel</h2>
    <p class="sub">Notes, tasks and a focus timer — the things you reach for while
    you are in the middle of something else.</p>
$features
  </div>
</section>

<section class="band" id="keys">
  <div class="wrap narrow">
    <h2>Hands stay on the keys</h2>
    <p class="sub">Nothing essential is hidden behind hover, and the panel is
    driven from the keyboard once it is open.</p>
    <div class="keys">
      <div class="key-row"><span>Open with a new note, from anywhere</span> <kbd>&#8984;&#8997;N</kbd></div>
      <div class="key-row"><span>Search the list in front of you</span> <kbd>&#8984;F</kbd></div>
      <div class="key-row"><span>New note, or new task</span> <kbd>&#8984;N</kbd></div>
      <div class="key-row"><span>Move through the cards or rows</span> <kbd>&#8593;</kbd> <kbd>&#8595;</kbd></div>
      <div class="key-row"><span>Tick the task you are on</span> <kbd>Space</kbd></div>
      <div class="key-row"><span>Close the editor, then the panel</span> <kbd>Esc</kbd></div>
      <div class="key-row"><span>Bold, italic, strikethrough, code</span> <kbd>&#8984;B</kbd> <kbd>&#8984;I</kbd> <kbd>&#8984;&#8679;X</kbd> <kbd>&#8984;E</kbd></div>
      <div class="key-row"><span>Bulleted, numbered, to-do list</span> <kbd>&#8984;&#8679;8</kbd> <kbd>&#8984;&#8679;7</kbd> <kbd>&#8984;&#8679;9</kbd></div>
      <div class="key-row"><span>Code block</span> <kbd>&#8984;&#8679;C</kbd></div>
      <div class="key-row"><span>Turn the line into something else</span> <kbd>/</kbd></div>
      <div class="key-row"><span>Start or stop the focus timer</span> <kbd>Space</kbd></div>
      <div class="key-row"><span>Reset it, or skip the phase</span> <kbd>R</kbd> <kbd>S</kbd></div>
    </div>
    <p class="fine" style="margin-top:22px">On Windows and Linux, <kbd>Ctrl</kbd>
    where this says <kbd>&#8984;</kbd>.</p>
  </div>
</section>

<section class="band soft" id="download">
  <div class="wrap">
    <h2>Download</h2>
    <p class="sub">Free, and the same app on all three. Installing from Homebrew or
    apt also keeps it up to date.</p>
$platforms
$key_section
  </div>
</section>

<section class="band">
  <div class="wrap narrow">
    <h2>Open source, closed to contributions</h2>
    <p>Ledge is free and open source, and it is not open to contributions: no
    pull requests, and no feature requests taken as a queue. This is one person's
    app, built to one set of opinions about what it should be, and keeping it
    that way is most of why it stays small and why it does what it does.</p>
    <p>Bug reports are the exception and they are welcome — if something is
    broken, <a href="$issues">open an issue</a> and say what happened, with the
    version and system from Settings › About. Everything else about a release —
    what changed, what is known to be broken — is in the
    <a href="changelog.html">changelog</a>.</p>
  </div>
</section>

<section class="band soft">
  <div class="wrap narrow">
    <h2>What it does not do</h2>
    <p>There is no account, no cloud and no sync: notes live in a SQLite file in
    the app's own data folder, and nothing leaves the machine. The window that
    draws the panel is given no filesystem, shell or database access of its own —
    everything stateful is handled by the native side, and links open in your
    browser rather than inside the app.</p>
    <p>It is a young project, and while the version is 0.x a release may change
    how something behaves. Deleted notes and tasks are kept for thirty days so an
    undo always has something to undo, and every release is listed with its
    changes in the
    <a href="changelog.html">changelog</a>.</p>
  </div>
</section>

</main>

<footer>
  <div class="wrap foot-row">
    <span>Ledge $version</span>
    <span class="spacer"></span>
    <a href="#download">Download</a>
    <a href="changelog.html">Changelog</a>
    <a href="$issues">Report a problem</a>
  </div>
</footer>

</body>
</html>
HTML

echo "wrote $repo/index.html"

# The changelog is published here, as a page and as the file itself, because the
# repository it is written in is private: "see the changelog" has to be a link a
# reader can open. The source of truth stays in the source repository and is
# copied on every release, so the two cannot drift.
changelog=$source_dir/CHANGELOG.md
if [ -f "$changelog" ]; then
  cp "$changelog" "$repo/CHANGELOG.md"

  # Markdown to HTML, for exactly the dialect the changelog is written in:
  # headings, bullet lists, links, bold, italic and inline code. Python rather
  # than sed because inline spans nest inside list items, and a regex pipeline
  # that gets that right is unreadable by the second rule.
  CHANGELOG_TITLE="Ledge — changelog" \
  CHANGELOG_NAV="$(nav_for "./")" \
  CHANGELOG_SCRIPT="$theme_script" \
  python3 - "$changelog" "$repo/changelog.html" <<'PYTHON'
import html
import os
import re
import sys

source, target = sys.argv[1], sys.argv[2]
lines = open(source, encoding="utf-8").read().splitlines()


def inline(text):
    """Bold, italic, inline code, links and bare <url> autolinks, in that order.

    Code is taken out first and put back last, so a `**` inside a snippet is not
    read as emphasis — the one nesting rule this dialect needs.
    """
    snippets = []

    def stash(match):
        snippets.append(html.escape(match.group(1)))
        return "\x00%d\x00" % (len(snippets) - 1)

    text = re.sub(r"`([^`]+)`", stash, text)
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"&lt;(https?://[^&\s]+)&gt;", r'<a href="\1">\1</a>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*([^*]+)\*(?![\w*])", r"<i>\1</i>", text)
    text = re.sub(r"(?<![\w_])_([^_]+)_(?![\w_])", r"<i>\1</i>", text)
    return re.sub(r"\x00(\d+)\x00", lambda m: "<code>%s</code>" % snippets[int(m.group(1))], text)


out = []
paragraph = []
item = []
in_list = False


def flush_paragraph(klass=""):
    global paragraph
    if paragraph:
        attribute = ' class="%s"' % klass if klass else ""
        out.append("    <p%s>%s</p>" % (attribute, inline(" ".join(paragraph))))
        paragraph = []


def flush_item():
    global item
    if item:
        out.append("      <li>%s</li>" % inline(" ".join(item)))
        item = []


def close_list():
    global in_list
    flush_item()
    if in_list:
        out.append("    </ul>")
        in_list = False


# Everything above the first version heading is the file talking to whoever
# maintains it — how to cut a release, where the tags are. The page says its own
# opening line instead and starts at the first version.
first_version = next(
    (index for index, line in enumerate(lines) if line.startswith("## ")), len(lines)
)
lines = lines[first_version:]

# A version heading with nothing under it — [Unreleased] between releases — is a
# section about nothing, and on a page it reads as a release that did not happen.
pruned = []
for index, line in enumerate(lines):
    if line.startswith("## "):
        rest = lines[index + 1 :]
        following = next(
            (later for later in rest if later.strip() != ""), ""
        )
        if following.startswith("## ") or following == "":
            continue
    pruned.append(line)
lines = pruned

first_paragraph = True
for line in lines:
    stripped = line.strip()
    if stripped.startswith("# "):
        # The page has its own title; the file's is not repeated.
        continue
    if stripped.startswith("## "):
        close_list()
        flush_paragraph("lede" if first_paragraph else "")
        first_paragraph = False
        heading = stripped[3:]
        # "## [0.4.0] - 2026-09-18": the version is the heading, the date sits
        # under it, because a list of versions is read by version.
        match = re.match(r"\[([^\]]+)\](?:\s*-\s*(.+))?$", heading)
        name = match.group(1) if match else heading
        when = match.group(2) if match and match.group(2) else ""
        anchor = re.sub(r"[^a-z0-9.]+", "-", name.lower())
        out.append('    <h2 id="%s">%s</h2>' % (anchor, html.escape(name)))
        if when:
            out.append('    <p class="when">%s</p>' % html.escape(when))
        continue
    if stripped.startswith("### "):
        close_list()
        flush_paragraph()
        out.append("    <h3>%s</h3>" % inline(stripped[4:]))
        continue
    if stripped.startswith("- "):
        flush_paragraph("lede" if first_paragraph else "")
        first_paragraph = False
        flush_item()
        if not in_list:
            out.append("    <ul>")
            in_list = True
        item.append(stripped[2:])
        continue
    if stripped == "":
        close_list()
        flush_paragraph("lede" if first_paragraph else "")
        first_paragraph = False
        continue
    # A continuation: of the bullet being read, or of the paragraph.
    (item if in_list else paragraph).append(stripped)

close_list()
flush_paragraph()

page = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<meta name="description" content="Every release of Ledge and what changed in it.">
<link rel="icon" href="icon.png" sizes="128x128" type="image/png">
<link rel="stylesheet" href="style.css">
%(script)s
</head>
<body>

%(nav)s

<main class="wrap narrow prose">
  <h1>Changelog</h1>
  <p class="lede">Every release of Ledge, newest first, and what changed in it.
  While the version is 0.x a release may change how something behaves.
  <a href="./#download">Downloads are here</a>.</p>
%(body)s
</main>

<footer>
  <div class="wrap foot-row">
    <a href="./">Downloads</a>
    <span class="spacer"></span>
    <a href="CHANGELOG.md">This file, as Markdown</a>
  </div>
</footer>

</body>
</html>
""" % {
    "title": html.escape(os.environ.get("CHANGELOG_TITLE", "Changelog")),
    "nav": os.environ.get("CHANGELOG_NAV", ""),
    "script": os.environ.get("CHANGELOG_SCRIPT", ""),
    "body": "\n".join(out),
}

open(target, "w", encoding="utf-8").write(page)
print("wrote", target)
PYTHON
fi

# The repository's own README, for whoever arrives at the GitHub page rather than
# the site. Generated from the same facts as the page, so the two cannot drift —
# the old one still named the package `edge-notes` long after it was renamed.
cat > "$repo/README.md" <<MARKDOWN
# Ledge downloads

Packages of **Ledge**, a notes, tasks and focus widget docked to the edge of
your screen — for macOS, Windows, Debian and Ubuntu.

**The downloads, with install instructions for each platform, are on the site
this repository serves: <$site/>**

**Found a bug?** [Open an issue here]($issues) — this is where they are
tracked. Please say which version (Settings › About in the app) and which
system. Every release and what changed in it is in
[CHANGELOG.md](CHANGELOG.md), also published as a page at
<$site/changelog.html>.

This repository is the publishing target, not the source: it holds the packages,
a signed APT index, the public key, the changelog and a generated landing page.
It is written by the release workflow in a separate, private source repository,
and nothing in it is edited by hand — an edit made here is overwritten by the
next release. Ledge is not open to contributions; see the site for what that
means.

## apt, in short

\`\`\`bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL $site/key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/ledge.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/ledge.gpg] $site stable main" \\
  | sudo tee /etc/apt/sources.list.d/ledge.list
sudo apt update
sudo apt install ${deb_package:-ledge}
\`\`\`

Debian 12+, Ubuntu 22.04+, x86_64. New versions then arrive with
\`sudo apt update && sudo apt upgrade\`. To remove it:
\`sudo apt remove ${deb_package:-ledge}\`, then
\`sudo rm /etc/apt/sources.list.d/ledge.list /etc/apt/keyrings/ledge.gpg\`.

## What is where

| Path | What |
|---|---|
| \`index.html\` | The landing page, generated on every release |
| \`screenshots/\` | The pictures on that page |
| \`pool/\`, \`dists/\` | The Debian packages and the signed index |
| \`macos/\` | The \`.dmg\`, with \`SHA256SUMS\` |
| \`windows/\` | The \`.exe\` and \`.msi\`, with \`SHA256SUMS\` |
| \`key.gpg\` | The public half of the APT signing key |

Older versions of every package are kept.
MARKDOWN

echo "wrote $repo/README.md"
