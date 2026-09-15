#!/usr/bin/env bash
# Add a release's Windows installers to the Edge Notes Pages site.
#
#   tools/publish_windows.sh <pages repository checkout> <installer>...
#
# Run by the Release workflow next to tools/publish_apt.sh. This source
# repository is private, so its Releases page is not a public download: the Pages
# site is where Windows users actually get the installers.
#
# Files keep the names the release gave them, which carry the version, so older
# versions stay downloadable exactly as the .deb pool keeps older packages.
# windows/SHA256SUMS is rebuilt from everything in the directory, so it can be
# checked with `sha256sum -c` after downloading the whole directory.
set -euo pipefail

repo=$1
shift

dir="$repo/windows"
mkdir -p "$dir"
for file in "$@"; do
  cp "$file" "$dir/$(basename "$file")"
  echo "added $(basename "$file")"
done

cd "$dir"
sums=$(mktemp)
# The glob is sorted already, and every name carries its version, so the file
# only changes when a package does.
for file in *; do
  case "$file" in SHA256SUMS) continue ;; esac
  sha256sum "$file" >> "$sums"
done
mv "$sums" SHA256SUMS
chmod 644 SHA256SUMS
