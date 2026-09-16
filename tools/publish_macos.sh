#!/usr/bin/env bash
# Add a release's macOS disk image to the Ledge Pages site.
#
#   tools/publish_macos.sh <pages repository checkout> <dmg>...
#
# Run by the Release workflow next to tools/publish_windows.sh, and for the same
# reason: this source repository is private, so its Releases page is not a public
# download. Homebrew has to fetch the .dmg from somewhere anonymous, and this is
# that somewhere — tools/publish_cask.sh points the cask's url at what this puts
# here.
#
# Files keep the names the release gave them, which carry the version, so older
# versions stay downloadable. macos/SHA256SUMS is rebuilt from everything in the
# directory; the cask pins its own sha256 separately, so the two must agree.
set -euo pipefail

repo=$1
shift

dir="$repo/macos"
mkdir -p "$dir"
for file in "$@"; do
  cp "$file" "$dir/$(basename "$file")"
  echo "added $(basename "$file")"
done

cd "$dir"
sums=$(mktemp)
for file in *; do
  case "$file" in SHA256SUMS) continue ;; esac
  sha256sum "$file" >> "$sums"
done
mv "$sums" SHA256SUMS
chmod 644 SHA256SUMS
