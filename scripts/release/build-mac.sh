#!/usr/bin/env bash
# Owns: building the macOS app (Apple Silicon + Intel) on a Linux x64 host (WSL Ubuntu 24.04, a VM or a CI runner)
# for as long as no Mac and no macOS CI runner is available:
#   autark-mac-arm64.zip  autark-mac-x64.zip      the app bundle, what the updater and the README link
#   latest-mac.yml                                the updater's feed (lists both zips)
# Usage: build-mac.sh <repo-root> <version> <out-dir>
# electron-builder packs a mac target on Linux but cannot sign there, and an unsigned arm64 app is killed by macOS on
# start. So every bundle is ad-hoc signed afterwards with rcodesign (apple-codesign) and the zip and its feed entry
# are rewritten from the signed bundle. Ad-hoc is not a Developer ID: Gatekeeper asks once ("Open anyway",
# README › macOS), and macOS refuses in-place updates of an ad-hoc app, so the updater only offers the download.
# No dmg: Linux has no compressed UDZO writer here, an ISO image was 490 MB and drops modes; the zip is what macOS
# Archive Utility and the updater read.
# Never: uses a real signing identity, uploads or changes the repository.
set -euo pipefail
repo=$(realpath "${1:?repo root}"); version=${2:?version, e.g. 0.4.0}; out=$(realpath -m "${3:?out dir}")
work="${AUTARK_BUILD_DIR:-$HOME/autark-build-mac}"
tools="${AUTARK_TOOLS_DIR:-$HOME/.local/autark-tools}"
rcodesign_version=0.29.0

# rcodesign: one static binary, fetched once and kept.
rcodesign="$tools/rcodesign"
if [[ ! -x "$rcodesign" ]]; then
  mkdir -p "$tools"
  name="apple-codesign-$rcodesign_version-x86_64-unknown-linux-musl"
  curl -fsSL "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F$rcodesign_version/$name.tar.gz" \
    | tar -xz -C "$tools" --strip-components=1 "$name/rcodesign"
fi

mkdir -p "$work"
rsync -a --delete --exclude .git --exclude node_modules --exclude /apps/desktop/dist --exclude /apps/desktop/app \
  --exclude /apps/android --exclude /.local "$repo/" "$work/"
cd "$work/apps/desktop"
npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
npm ci --no-fund --no-audit
# The voice add-on for both Mac CPUs; npm on Linux installs neither by itself.
sherpa=$(node -p 'require("sherpa-onnx-node/package.json").version')
npm install --no-save --force --no-fund --no-audit "sherpa-onnx-darwin-x64@$sherpa" "sherpa-onnx-darwin-arm64@$sherpa"
npm run build
rm -rf dist
# dir only: the zip is made from the signed bundle below, electron-builder's own zip would hold the unsigned one.
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package -- --mac dir --x64 --arm64 -c.mac.identity=null

mkdir -p "$out"
feed_files=""
for arch in arm64 x64; do
  case $arch in arm64) dir=dist/mac-arm64 cpu=arm64 ;; x64) dir=dist/mac cpu=x86_64 ;; esac
  app=$(find "$dir" -maxdepth 1 -name '*.app' | head -1)
  [[ -d "$app" ]] || { echo "No app bundle in $dir"; ls -la dist; exit 1; }
  # Wrong CPU fails the build before anything is signed or copied out.
  main="$app/Contents/MacOS/$(basename "$app" .app)"
  file "$main" | grep -q "$cpu" || { echo "$main is not $cpu: $(file "$main")"; exit 1; }
  ls "$app/Contents/Resources/app.asar.unpacked/node_modules/" | grep -q "sherpa-onnx-darwin-$arch" \
    || { echo "voice add-on sherpa-onnx-darwin-$arch missing in $app"; exit 1; }
  "$rcodesign" sign "$app" >/dev/null
  # rcodesign verify expects a CMS blob, which an ad-hoc signature has none of; so the flag itself is checked.
  "$rcodesign" print-signature-info "$main" | grep -q ADHOC || { echo "$main is not ad-hoc signed"; exit 1; }
  zip="$out/autark-mac-$arch.zip"
  rm -f "$zip"
  # ditto-style zip: keep symlinks (-y) and the bundle as the top entry; macOS Archive Utility and Squirrel read it.
  (cd "$(dirname "$app")" && zip -qry "$zip" "$(basename "$app")")
  sha=$(openssl dgst -sha512 -binary "$zip" | base64 -w0); size=$(stat -c %s "$zip")
  feed_files+="  - url: autark-mac-$arch.zip
    sha512: $sha
    size: $size
"
  [[ $arch == arm64 ]] && { first_sha=$sha; }
done
cat > "$out/latest-mac.yml" <<EOF
version: $version
files:
$feed_files path: autark-mac-arm64.zip
sha512: $first_sha
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
EOF
ls -la "$out"/autark-mac-* "$out/latest-mac.yml"
