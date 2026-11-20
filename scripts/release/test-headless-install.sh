#!/usr/bin/env bash
# Owns: proving scripts/install-headless.sh on a fresh Linux system, as root, end to end – the way a person runs it
# (piped into bash), against real release files: download + checksum, system libraries, service user, systemd unit,
# web access answering, pairing code, a repeated install, --update, --uninstall (data kept) and --uninstall --purge.
# Usage (as root on the system under test):
#   AUTARK_DOWNLOAD_BASE=http://<mirror>/ bash test-headless-install.sh <install-headless.sh> <version>
#   bash test-headless-install.sh <install-headless.sh> <version>          (downloads from GitHub)
# Exit 0 = every step passed. Never: runs on a system that has Autark data it did not create (it purges at the end).
set -uo pipefail
script=${1:?path to install-headless.sh}; version=${2:?version, e.g. 0.3.9}
[ "$(id -u)" -eq 0 ] || { echo 'Run as root.' >&2; exit 2; }
if [ -d /var/lib/autark ] && [ ! -f /var/lib/autark/.autark-install-test ]; then
  echo '/var/lib/autark holds data this test did not create – not touching it.' >&2; exit 2
fi
fails=0
pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*"; fails=$((fails + 1)); }
check() { local name=$1; shift; if "$@" >/tmp/check.out 2>&1; then pass "$name"; else fail "$name"; sed 's/^/     /' /tmp/check.out | tail -n 15; fi; }
port_open() { (exec 3<>/dev/tcp/127.0.0.1/47811) 2>/dev/null; }
wait_port() { local i; for i in $(seq 1 60); do port_open && return 0; sleep 1; done; return 1; }
run_installer() { bash -s -- "$@" <"$script"; } # exactly what "curl … | sudo bash -s -- …" does

. /etc/os-release
echo "== $PRETTY_NAME ($(uname -m)) – installer test for v$version"
check 'install (piped into bash, download + checksum)' run_installer --version "v$version"
touch /var/lib/autark/.autark-install-test 2>/dev/null || true
check 'service is active' systemctl is-active --quiet autark
check 'service runs as user autark' bash -c '[ "$(systemctl show -p User --value autark)" = autark ]'
check 'web access answers on port 47811' wait_port
check 'autark-headless version' bash -c "[ \"\$(autark-headless version)\" = '$version' ]"
check 'autark-headless pair prints a code' bash -c 'autark-headless pair | grep -Eiq "code|http"'
check 'data folder belongs to autark, mode 700' bash -c '[ "$(stat -c %U:%a /var/lib/autark)" = autark:700 ]'
check 'installing again keeps it running' bash -c "$(declare -f run_installer); script='$script'; run_installer && systemctl is-active --quiet autark"
check '--update: already the newest' bash -c "$(declare -f run_installer); script='$script'; run_installer --update --version v$version | grep -q 'already the newest'"
check 'service survives a restart' bash -c 'systemctl restart autark && sleep 3 && systemctl is-active --quiet autark'
check 'uninstall keeps the data' bash -c "$(declare -f run_installer); script='$script'; run_installer --uninstall && [ -d /var/lib/autark ] && [ ! -e /opt/autark ] && ! systemctl cat autark >/dev/null 2>&1"
check 'reinstall over kept data' bash -c "$(declare -f run_installer); script='$script'; run_installer --version v$version && systemctl is-active --quiet autark"
check 'uninstall --purge removes everything' bash -c "$(declare -f run_installer); script='$script'; run_installer --uninstall --purge && [ ! -e /var/lib/autark ] && [ ! -e /etc/autark ] && ! id autark >/dev/null 2>&1"
if [ "$fails" -eq 0 ]; then echo "== ALL PASSED on $PRETTY_NAME"; else echo "== $fails FAILED on $PRETTY_NAME"; fi
exit "$fails"
