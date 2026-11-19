#!/usr/bin/env bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git rsync xz-utils unzip build-essential python3 libfuse2t64 fakeroot dpkg-dev rpm zsync xvfb xauth dbus-x11 libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libxss1 libxtst6 gh >/dev/null
if ! command -v node >/dev/null; then
  f=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep 'linux-x64.tar.xz' | awk '{print $2}')
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$f" | tar -xJ -C /usr/local --strip-components=1
fi
node -v; npm -v; gh --version | head -1
