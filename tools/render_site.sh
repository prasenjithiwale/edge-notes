#!/usr/bin/env bash
# Write the landing page of the Edge Notes Pages site.
#
#   tools/render_site.sh <pages repository checkout>
#
# Run by the Release workflow after publish_apt.sh and publish_windows.sh, so the
# page describes what is actually published: the versions, file names and sizes
# all come from the checkout, never from an argument that could disagree with it.
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
pick_newest() {
  REPLY=
  if [ "$#" -gt 0 ]; then
    REPLY=$(printf '%s\n' "$@" | sort -V | tail -1)
  fi
}

pick_newest "$repo"/pool/main/e/edge-notes/*.deb; deb=$REPLY
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
curl -fsSL $site/key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/edge-notes.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/edge-notes.gpg] $site stable main" \\
  | sudo tee /etc/apt/sources.list.d/edge-notes.list
sudo apt update
sudo apt install edge-notes</code></pre>

  <h2>Removing it</h2>
<pre><code>sudo apt remove edge-notes
sudo rm /etc/apt/sources.list.d/edge-notes.list /etc/apt/keyrings/edge-notes.gpg</code></pre>
HTML
)
fi

key_section=
if [ -n "$deb" ] && [ -n "$fingerprint" ]; then
  key_section=$(cat <<HTML

  <h2>Signing key</h2>
  <p>The APT repository is signed by &quot;Edge Notes APT repository&quot;, RSA
  4096, fingerprint <code>$fingerprint</code>.</p>
HTML
)
fi

# Each section opens with a blank line and lost its closing newline to command
# substitution; putting that back is all the joining these need.
body=
for section in "$windows_section" "$linux_section" "$key_section"; do
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
<title>Edge Notes downloads</title>
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
  <h1>Edge Notes</h1>
  <p>A notes widget docked to the edge of your screen. Point at the tab and a
  panel of colour-coded notes slides out; move away and it slides back.
  <a href="https://github.com/prasenjithiwale/edge-notes">About the project</a>.</p>
$body
</main>
</body>
</html>
HTML

echo "wrote $repo/index.html"
