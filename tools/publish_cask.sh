#!/usr/bin/env bash
# Write the Homebrew cask for a release into the Ledge tap.
#
#   tools/publish_cask.sh <tap repository checkout> <dmg>
#
# Run by the Release workflow after tools/publish_macos.sh, which is what puts
# the .dmg at the url written here. The cask is generated, like the landing page:
# an edit made by hand in the tap is overwritten by the next release, so change
# this script instead.
#
# About the quarantine step. The app is not signed with a Developer ID and is not
# notarised, so Gatekeeper rejects it ("no usable signature") and macOS refuses to
# open it while it carries com.apple.quarantine, which Homebrew applies to every
# cask it installs. `--no-quarantine` used to be the answer; it was deprecated in
# October 2025 and removed from Homebrew in July 2026. A postflight step that
# strips the attribute is what is left. It runs in Homebrew's install sandbox,
# which allows writes to appdir, so it needs no privileges.
#
# This is a real trade-off, not a formality: it means the app is installed
# without a Gatekeeper check. The landing page says so in as many words, and the
# honest fix is a Developer ID signature and notarisation, after which this step
# can go.
set -euo pipefail

tap=$1
dmg=$2
site=https://prasenjithiwale.github.io/edge-notes-apt

name=$(basename "$dmg")
# Every published file is named <product>_<version>_<platform>..., as the site's
# renderer also relies on.
version=$(echo "$name" | cut -d_ -f2)

# CI is Linux and a hand run is macOS; neither has both of these.
if command -v sha256sum >/dev/null 2>&1; then
  sha=$(sha256sum "$dmg" | cut -d' ' -f1)
else
  sha=$(shasum -a 256 "$dmg" | cut -d' ' -f1)
fi

mkdir -p "$tap/Casks"
cat > "$tap/Casks/edge-notes.rb" <<CASK
# The token stays edge-notes although the app is Ledge now: it is what an
# existing install is upgraded by, and changing it would strand everyone who has
# already installed from this tap on 0.0.4.
#
# No backticks anywhere in this heredoc: it is unquoted, so the shell would run
# what is between them while generating the cask.
cask "edge-notes" do
  version "$version"
  sha256 "$sha"

  url "$site/macos/Ledge_#{version}_macOS_universal.dmg"
  name "Ledge"
  desc "Notes widget docked to the edge of the screen"
  # The site, not the source repository: that one is private and a cask
  # homepage is something people click.
  homepage "https://prasenjithiwale.github.io/edge-notes-apt/"

  # Bare symbol, not ">= :monterey": Homebrew 7 deprecated the string form, and
  # this one already means "Monterey or newer" (its comparator defaults to >=).
  depends_on macos: :monterey

  app "Ledge.app"

  # The build is unsigned and unnotarised, so it cannot open while quarantined.
  # See tools/publish_cask.sh in the source repository for why this is here and
  # what would remove it.
  postflight_steps do
    run "/usr/bin/xattr",
        args: ["-dr", "com.apple.quarantine", "{{appdir}}/Ledge.app"]
  end

  # Both identifiers: the app was dev.edgenotes.app up to 0.0.4, and an install
  # upgraded from it copied its database across but left the old folder behind.
  zap trash: [
    "~/Library/Application Support/dev.ledge.app",
    "~/Library/Application Support/dev.edgenotes.app",
    "~/Library/Caches/dev.ledge.app",
    "~/Library/Caches/dev.edgenotes.app",
    "~/Library/HTTPStorages/dev.ledge.app",
    "~/Library/HTTPStorages/dev.edgenotes.app",
    "~/Library/Preferences/dev.ledge.app.plist",
    "~/Library/Preferences/dev.edgenotes.app.plist",
    "~/Library/Saved Application State/dev.ledge.app.savedState",
    "~/Library/Saved Application State/dev.edgenotes.app.savedState",
    "~/Library/WebKit/dev.ledge.app",
    "~/Library/WebKit/dev.edgenotes.app",
  ]
end
CASK

echo "wrote $tap/Casks/edge-notes.rb for $version"
