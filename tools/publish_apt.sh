#!/usr/bin/env bash
# Add Debian packages to the Edge Notes APT repository and re-sign its index.
#
#   tools/publish_apt.sh <apt repository checkout> <package.deb>...
#
# Run by the Release workflow. Packages are kept under pool/ (older versions stay,
# so `apt install edge-notes=0.0.2` still works); the index under dists/stable is
# rebuilt from the whole pool and signed with the key already imported into gpg.
# Needs apt-ftparchive (apt-utils), dpkg-deb and gpg.
set -euo pipefail

repo=$1
shift

pool="$repo/pool/main/e/edge-notes"
mkdir -p "$pool"
for deb in "$@"; do
  version=$(dpkg-deb --field "$deb" Version)
  arch=$(dpkg-deb --field "$deb" Architecture)
  cp "$deb" "$pool/edge-notes_${version}_${arch}.deb"
  echo "added edge-notes $version ($arch)"
done

cd "$repo"
dist=dists/stable
binary="$dist/main/binary-amd64"
mkdir -p "$binary"

# Paths in Packages are relative to the repository root, as apt expects.
apt-ftparchive --arch amd64 packages pool/main > "$binary/Packages"
gzip -9 --no-name --keep --force "$binary/Packages"

config=$(mktemp)
cat > "$config" <<CONF
APT::FTPArchive::Release::Origin "Edge Notes";
APT::FTPArchive::Release::Label "Edge Notes";
APT::FTPArchive::Release::Suite "stable";
APT::FTPArchive::Release::Codename "stable";
APT::FTPArchive::Release::Architectures "amd64";
APT::FTPArchive::Release::Components "main";
APT::FTPArchive::Release::Description "Edge Notes, a notes widget docked to the edge of your screen";
CONF
# Written elsewhere first: the Release file must not list itself.
apt-ftparchive -c "$config" release "$dist" > "$config.release"
mv "$config.release" "$dist/Release"
rm -f "$config"

key=$(gpg --batch --list-secret-keys --with-colons | awk -F: '/^fpr/ {print $10; exit}')
if [ -z "$key" ]; then
  echo "no signing key imported" >&2
  exit 1
fi
gpg --batch --yes --local-user "$key" --clearsign --output "$dist/InRelease" "$dist/Release"
gpg --batch --yes --local-user "$key" --armor --detach-sign --output "$dist/Release.gpg" "$dist/Release"
gpg --batch --armor --export "$key" > key.gpg

# A signature that does not verify would break every user's `apt update`.
gpg --batch --verify "$dist/InRelease"
gpg --batch --verify "$dist/Release.gpg" "$dist/Release"
