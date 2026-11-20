#!/usr/bin/env bash
# Owns: checking electron-builder's Linux output before it leaves the build folder, then copying it out:
# every package holds a binary for the CPU its name says, both tarballs carry their voice add-on, both debs name their
# arch, and the update feeds point at the right files. Usage: check-linux-dist.sh <dist-dir> <out-dir>
# Never: changes the packages.
set -euo pipefail
dist=$(realpath "${1:?dist dir}"); out=$(realpath -m "${2:?out dir}")
check_elf() { # <file> <x64|arm64>
  local want info
  case "$2" in x64) want='x86-64' ;; arm64) want='ARM aarch64' ;; esac
  info=$(file -L "$1")
  [[ "$info" == *"$want"* ]] || { echo "Wrong CPU in $1 (expected $2): $info" >&2; exit 1; }
  echo "ok  $(basename "$1"): $2"
}
check_elf "$dist/autark-linux-x64.AppImage" x64
for arch in x64 arm64; do
  t=$(mktemp -d)
  tar -xzf "$dist/autark-linux-$arch.tar.gz" -C "$t"
  exe=$(find "$t" -maxdepth 3 -type f -name autark | head -n 1)
  [ -n "$exe" ] || { echo "autark-linux-$arch.tar.gz has no autark binary" >&2; exit 1; }
  check_elf "$exe" "$arch"
  [ -d "$(dirname "$exe")/resources/app.asar.unpacked/node_modules/sherpa-onnx-linux-$arch" ] \
    || { echo "autark-linux-$arch.tar.gz lacks the voice add-on sherpa-onnx-linux-$arch" >&2; exit 1; }
  echo "ok  autark-linux-$arch.tar.gz: voice add-on sherpa-onnx-linux-$arch"
  rm -rf "$t"
done
for deb in amd64 arm64; do
  [ "$(dpkg-deb -f "$dist/autark-linux-$deb.deb" Architecture)" = "$deb" ] || { echo "autark-linux-$deb.deb has the wrong Architecture" >&2; exit 1; }
  echo "ok  autark-linux-$deb.deb: Architecture $deb"
done
grep -q 'url: autark-linux-x64.AppImage' "$dist/latest-linux.yml" || { echo 'latest-linux.yml lacks the AppImage' >&2; exit 1; }
! grep -q 'AppImage' "$dist/latest-linux-arm64.yml" || { echo 'latest-linux-arm64.yml names an AppImage (there is no arm64 one)' >&2; exit 1; }
size=$(stat -c %s "$dist/autark-linux-x64.AppImage")
grep -q "size: $size" "$dist/latest-linux.yml" || { echo "latest-linux.yml does not match the AppImage's size $size" >&2; exit 1; }
echo 'ok  update feeds'
mkdir -p "$out"
rm -f "$out"/autark-linux-* "$out"/latest-linux*.yml # only our own files: the folder may hold other platforms
cp -f "$dist"/autark-linux-*.tar.gz "$dist"/autark-linux-*.AppImage "$dist"/autark-linux-*.deb "$dist"/latest-linux*.yml "$out/"
ls -la "$out"
