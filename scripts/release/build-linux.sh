#!/usr/bin/env bash
# Owns: building the Linux packages (x64 + arm64) on a Linux x64 host (WSL Ubuntu 24.04, a VM or a CI runner):
#   autark-linux-x64.tar.gz  autark-linux-arm64.tar.gz      what scripts/install-headless.sh downloads
#   autark-linux-x64.AppImage                               desktop, any distribution (x64 only)
#   autark-linux-amd64.deb  autark-linux-arm64.deb          desktop on Debian/Ubuntu (deb names the arch amd64)
#   latest-linux.yml  latest-linux-arm64.yml                the updater's feeds
# Usage: build-linux.sh <repo-root> <version> <out-dir>
# The whole repository is copied to a Linux folder first (builds on /mnt/c are slow and break symlinks); the repo is
# not touched. Every binary's CPU is checked before anything is copied out: a package for the wrong CPU fails the build.
# Never: signs, uploads or changes the repository.
set -euo pipefail
repo=$(realpath "${1:?repo root}"); version=${2:?version, e.g. 0.3.9}; out=$(realpath -m "${3:?out dir}")
work="${AUTARK_BUILD_DIR:-$HOME/autark-build}"
mkdir -p "$work"
rsync -a --delete --exclude .git --exclude node_modules --exclude /apps/desktop/dist --exclude /apps/desktop/app \
  --exclude /apps/android --exclude /.local "$repo/" "$work/"
cd "$work/apps/desktop"
npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
npm ci --no-fund --no-audit
# npm installs the voice add-on only for the build host's CPU; the arm64 package needs its own beside it.
sherpa=$(node -p 'require("sherpa-onnx-node/package.json").version')
npm install --no-save --force --no-fund --no-audit "sherpa-onnx-linux-x64@$sherpa" "sherpa-onnx-linux-arm64@$sherpa"
npm run build
rm -rf dist
# No --x64/--arm64 here: CLI arch flags override the per-target archs in package.json and build an arm64 AppImage
# under the fixed name autark-linux-x64.AppImage. package.json alone says which target gets which CPU.
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package -- --linux

# Wrong CPU, a missing voice add-on or a feed that does not match fails here, before anything is copied out.
bash "$(dirname "$(realpath "$0")")/check-linux-dist.sh" dist "$out"
