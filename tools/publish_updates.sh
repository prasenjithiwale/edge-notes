#!/usr/bin/env bash
# Write the in-app updater's feed (idea 6) into the Ledge Pages site.
#
#   tools/publish_updates.sh <pages repository checkout> <site url> <version> <dir>
#
# <dir> holds the release's updater files and their .sig files, as the release
# names them:
#
#   Ledge_<v>_macOS_universal.app.tar.gz        (+ .sig)
#   Ledge_<v>_windows_x64-setup.exe             (+ .sig)
#   Ledge_<v>_windows_x64.msi                   (+ .sig)
#   Ledge_<v>_linux_x86_64.AppImage             (+ .sig)
#
# updates/ holds the current version only: the feed never points anywhere else,
# and keeping every old AppImage would grow the site by a hundred megabytes a
# release. The installers people download by hand stay in macos/ and windows/.
# A platform with no files in this release is left out of the feed, so its
# copies are simply not offered anything. A feed that is already newer (an old
# tag published again by hand) is left alone.
set -euo pipefail

repo=$1
site=$2
version=$3
incoming=$4

dir="$repo/updates"
feed="$dir/latest.json"

if [ -f "$feed" ]; then
  current=$(jq -r .version "$feed")
  newest=$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -n 1)
  if [ "$newest" != "$version" ]; then
    echo "The feed already offers $current; leaving it for $version."
    exit 0
  fi
fi

platforms='{}'
# Every key the updater may look for on a copy of that kind: it tries
# `<os>-<arch>-<installer>` first and then `<os>-<arch>`. The macOS build is
# universal, so both architectures get the same file.
add() {
  local file=$1
  shift
  if [ ! -f "$incoming/$file" ] || [ ! -f "$incoming/$file.sig" ]; then
    echo "no $file (or its signature) in this release; left out of the feed"
    return
  fi
  cp "$incoming/$file" "$dir/$file"
  local signature
  signature=$(cat "$incoming/$file.sig")
  for key in "$@"; do
    platforms=$(jq --arg key "$key" --arg url "$site/updates/$file" --arg sig "$signature" \
      '.[$key] = {url: $url, signature: $sig}' <<<"$platforms")
  done
  echo "added $file for $*"
}

rm -rf "$dir"
mkdir -p "$dir"
add "Ledge_${version}_macOS_universal.app.tar.gz" darwin-aarch64 darwin-x86_64
add "Ledge_${version}_windows_x64-setup.exe" windows-x86_64-nsis windows-x86_64
add "Ledge_${version}_windows_x64.msi" windows-x86_64-msi
add "Ledge_${version}_linux_x86_64.AppImage" linux-x86_64-appimage

jq -n \
  --arg version "$version" \
  --arg notes "What changed: $site/changelog.html" \
  --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson platforms "$platforms" \
  '{version: $version, notes: $notes, pub_date: $date, platforms: $platforms}' >"$feed"
chmod 644 "$feed"
cat "$feed"
