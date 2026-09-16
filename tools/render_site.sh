#!/usr/bin/env bash
# Write the landing page of the Ledge Pages site.
#
#   tools/render_site.sh <pages repository checkout>
#
# Run by the Release workflow after publish_apt.sh, publish_macos.sh and
# publish_windows.sh, so the page describes what is actually published: the
# versions, file names and sizes all come from the checkout, never from an
# argument that could disagree with it.
# The page is generated. An edit made by hand in the site repository is
# overwritten by the next release; change this script instead.
set -euo pipefail
shopt -s nullglob

repo=$1
site=https://prasenjithiwale.github.io/edge-notes-apt

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

macos_section=
if [ -n "$dmg" ]; then
  macos_section=$(cat <<HTML

  <h2>macOS</h2>
  <p>macOS 12 Monterey or later, Apple silicon and Intel in one build. Version
  $(version_of "$dmg"). Homebrew is the easier route, and brings new versions
  with <code>brew upgrade</code>:</p>
<pre><code>brew trust --cask prasenjithiwale/tap/edge-notes
brew install --cask prasenjithiwale/tap/edge-notes</code></pre>
  <p>Homebrew will not load a cask from a tap outside its own repositories until
  you say you trust it, which is what the first line is; the second adds the tap
  and installs. Afterwards it is just <code>edge-notes</code>, as in
  <code>brew upgrade edge-notes</code>.</p>
  <p>Or take the disk image and drag the app to Applications:</p>
  <p class="downloads">
    <a class="download" href="$site/macos/$(basename "$dmg")">Disk image (.dmg) &middot; $(size_of "$dmg")</a>
  </p>
  <p>These builds are not signed with an Apple Developer ID and are not
  notarised, so macOS will not open the app while it carries the quarantine flag
  that anything downloaded gets. <b>The Homebrew cask removes that flag for
  you</b> — which also means the app is installed without a Gatekeeper check, so
  install it only if you trust this site. After the <code>.dmg</code>, do it
  yourself once:</p>
<pre><code>xattr -dr com.apple.quarantine "/Applications/Ledge.app"</code></pre>
  <p>To check a download first, compare it with
  <a href="$site/macos/SHA256SUMS">SHA256SUMS</a> (<code>shasum -a 256</code>).
  To remove the app: <code>brew uninstall --cask edge-notes</code>, or drag it to
  the Bin.</p>
HTML
)
fi

windows_section=
if [ -n "$setup" ] && [ -n "$msi" ]; then
  windows_section=$(cat <<HTML

  <h2>Windows</h2>
  <p>Windows 10 and 11, 64-bit. Version $(version_of "$setup").</p>
  <p class="downloads">
    <a class="download" href="$site/windows/$(basename "$setup")">Installer (.exe) &middot; $(size_of "$setup")</a>
    <a class="download" href="$site/windows/$(basename "$msi")">Package (.msi) &middot; $(size_of "$msi")</a>
  </p>
  <p>The installer is the usual choice; the <code>.msi</code> is there for
  deploying it across a fleet. Both install the same app, and fetch the WebView2
  runtime if Windows does not already have it.</p>
  <p>These builds are not code-signed, so SmartScreen warns the first time:
  choose <b>More info</b>, then <b>Run anyway</b>. To check a download first,
  compare it with <a href="$site/windows/SHA256SUMS">SHA256SUMS</a>
  (<code>Get-FileHash</code> in PowerShell).</p>
HTML
)
fi

linux_section=
if [ -n "$deb" ]; then
  linux_section=$(cat <<HTML

  <h2>Debian and Ubuntu</h2>
  <p>Debian 12+, Ubuntu 22.04+, Kubuntu and derivatives, x86_64. Version
  $(version_of "$deb"). Installing from this repository means new versions arrive
  with <code>sudo apt update &amp;&amp; sudo apt upgrade</code>.</p>
<pre><code>sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL $site/key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/ledge.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/ledge.gpg] $site stable main" \\
  | sudo tee /etc/apt/sources.list.d/ledge.list
sudo apt update
sudo apt install $deb_package</code></pre>
  <p>The app was called Edge Notes until 0.1.0 and its package was
  <code>edge-notes</code>. If you installed that one, the line above replaces it:
  <code>ledge</code> declares <code>Replaces</code> and <code>Conflicts</code> on
  the old name, so apt takes it out rather than leaving both installed. Your notes
  come across on first launch.</p>

  <h2>Removing it</h2>
<pre><code>sudo apt remove $deb_package
sudo rm /etc/apt/sources.list.d/ledge.list /etc/apt/keyrings/ledge.gpg</code></pre>
HTML
)
fi

key_section=
if [ -n "$deb" ] && [ -n "$fingerprint" ]; then
  key_section=$(cat <<HTML

  <h2>Signing key</h2>
  <p>The APT repository is signed by &quot;Edge Notes APT repository&quot; (named
  before the app was), RSA
  4096, fingerprint <code>$fingerprint</code>.</p>
HTML
)
fi

# Each section opens with a blank line and lost its closing newline to command
# substitution; putting that back is all the joining these need.
body=
for section in "$macos_section" "$windows_section" "$linux_section" "$key_section"; do
  if [ -n "$section" ]; then
    body+="$section"$'\n'
  fi
done
body=${body%$'\n'}

cat > "$repo/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ledge downloads</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1d1d1f; --muted:#6e6e73; --code:#f4f4f5; --border:rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { :root { --bg:#1c1c1e; --fg:#f2f2f3; --muted:#a1a1a6; --code:#2a2a2d; --border:rgba(255,255,255,.08); } }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui,-apple-system,"Segoe UI",Ubuntu,Cantarell,sans-serif; }
  main { max-width:680px; margin:0 auto; padding:48px 20px; }
  h1 { font-size:24px; font-weight:600; margin:0 0 4px; }
  h2 { font-size:16px; font-weight:600; margin:32px 0 8px; }
  p { margin:8px 0; color:var(--muted); }
  pre { background:var(--code); border:1px solid var(--border); border-radius:10px; padding:14px 16px; overflow-x:auto; font-size:13px; line-height:1.6; color:var(--fg); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  a { color:inherit; }
  .downloads { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
  .download { display:inline-block; background:var(--code); border:1px solid var(--border); border-radius:10px; padding:10px 14px; color:var(--fg); text-decoration:none; font-weight:600; }
  .download:hover { border-color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Ledge</h1>
  <p>A notes widget docked to the edge of your screen. Point at the tab and a
  panel of colour-coded notes slides out; move away and it slides back.
  <a href="https://github.com/prasenjithiwale/edge-notes">About the project</a>.</p>
$body
</main>
</body>
</html>
HTML

echo "wrote $repo/index.html"
