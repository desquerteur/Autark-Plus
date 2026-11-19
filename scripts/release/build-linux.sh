#!/usr/bin/env bash
# Owns: building the Linux packages (x64 + arm64) on a Linux host (WSL Ubuntu, a VM or a CI runner):
#   autark-linux-x64.tar.gz  autark-linux-arm64.tar.gz  (what scripts/install-headless.sh downloads)
#   autark-linux-x64.AppImage  autark-linux-x64.deb  autark-linux-arm64.deb  (desktop installs) + latest-linux.yml
# Usage: build-linux.sh <repo-root> <version> <out-dir>
# The whole repository is copied to a Linux folder first (builds on /mnt/c are slow and break symlinks); the repo is not touched.
# Never: signs, uploads or changes the repository.
set -euo pipefail
repo=$(realpath "${1:?repo root}"); version=${2:?version, e.g. 0.3.9}; out=$(realpath -m "${3:?out dir}")
work="${AUTARK_BUILD_DIR:-$HOME/autark-build}"
mkdir -p "$work" "$out"
rsync -a --delete --exclude .git --exclude node_modules --exclude /apps/desktop/dist --exclude /apps/desktop/app \
  --exclude /apps/android --exclude /.local "$repo/" "$work/"
cd "$work/apps/desktop"
npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
npm ci --no-fund --no-audit
npm run build
rm -rf dist
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package -- --linux --x64 --arm64
shopt -s nullglob
for f in dist/autark-linux-*.tar.gz dist/autark-linux-*.AppImage dist/autark-linux-*.deb dist/latest-linux*.yml; do cp -f "$f" "$out/"; done
ls -la "$out"
