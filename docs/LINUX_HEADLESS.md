# Linux headless

Autark can run on Linux **without a window**, as a background service. You use it in a **browser** or on your **phone**. Two cases:

- **Linux server** (no screen, no X/Wayland): a system service with its own user `autark`.
- **Linux desktop**: a service of your own user; you do not need the window.

Only Autark's core (the runtime) starts. It uses the app's own binary in plain Node mode (`ELECTRON_RUN_AS_NODE=1`) and needs no screen, no GPU
and no X/Wayland.

> **The headless service has its own data.** It does not use the desktop app's folder (`~/.config/Autark`). The desktop app protects secrets with the
> system keychain; the headless service uses a key file; and two Autark runtimes on the same data would disturb each other.

A longer German original with every detail is [headless-linux.md](headless-linux.md).

## What was not tested

Tested on Windows: the headless start (runtime without a window), the pairing link and code, `pair`, redeeming a code, the lock against a second
start, the files the script generates and `bash -n` on the script (11 automated tests). **Not run on a real Linux host:** the download from the
release, unpacking, system libraries, the systemd service, `autark-headless` as the `autark` user, and `--update` / `--uninstall`.
Treat the installer as untested until you have run it once on your machine and checked `autark-headless status`.

## Install

You need Linux on **x86_64** or **aarch64**, `curl`, `tar` and **systemd**.

**Server (system service):**

```bash
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | sudo bash
```

The script downloads the newest Linux build from the releases of `desquerteur/Autark-Plus` (`autark-linux-x64.tar.gz`, otherwise the AppImage; on
arm64 `autark-linux-arm64.tar.gz`), verifies the checksum when the release has a `SHA256SUMS.txt`, installs missing system libraries (apt, dnf,
zypper or pacman), creates the user `autark`, starts the service and prints a **pairing link and code**.

| What | Where (server) | Where (desktop, without `sudo`) |
| --- | --- | --- |
| Program | `/opt/autark/releases/<version>`, active: `/opt/autark/current` | `~/.local/opt/autark/current` |
| Data | `/var/lib/autark` (readable only by `autark`) | `~/.local/share/autark` |
| Settings | `/etc/autark/autark.env` | `~/.config/autark/autark.env` |
| Command | `/usr/local/bin/autark-headless` | `~/.local/bin/autark-headless` |
| Service | `/etc/systemd/system/autark.service` | `~/.config/systemd/user/autark.service` |

**Desktop:** run the same command without `sudo`. Add `--linger` to keep it running after you log out:
`curl -fsSL .../install-headless.sh | bash -s -- --linger`.

Defaults: a server is reachable in the **local network** (`--bind lan`) on port **47811**; a desktop install only from **this computer** (`--bind localhost`).

### Options

Options go after `bash -s --`, for example `... | sudo bash -s -- --bind tailscale`.

| Option | Meaning |
| --- | --- |
| `--server` / `--desktop` | Kind of install (default: server with `sudo`, otherwise desktop) |
| `--bind localhost\|lan\|tailscale` | Who can reach Autark: only this computer / the local network / your Tailscale network |
| `--port N` | Port of the web interface (default 47811) |
| `--version v0.3.8` | A specific version instead of the newest |
| `--repo owner/name` | Another release source (default `desquerteur/Autark-Plus`) |
| `--file PATH` | Install an already downloaded `.tar.gz` or `.AppImage` |
| `--no-deps` | Do not install system libraries |
| `--no-start` | Set up but do not start |
| `--linger` | Desktop: keep running after logout |
| `--update` | Update to the newest version |
| `--uninstall` / `--purge` | Remove / also delete all data |

Running the script again is safe: it re-sets everything up and leaves your data and `autark.env` alone (unless you pass `--bind` or `--port` again).

## Pairing a browser or phone

While no device is paired, Autark prints a **pairing link** and a **6-digit code** (the installer shows them):

```
Pair a phone or browser (works once, for 10 minutes):
  Link:  http://192.168.1.20:47811/#pair=...
  Code:  123 456   (type it into the installed Autark app on the phone)
```

- **Browser:** open the link; that browser then has full access.
- **Phone app:** type the code into the installed Autark app.
- Link and code work **once** and for **10 minutes**. A new one: `autark-headless pair`.
- With `--bind localhost`, only a browser on the same computer can open the link (`http://localhost:47811/#pair=...`); a phone connects through the
  Autark app and the meeting server (Remote ID), or switch to `lan` / `tailscale`.

Paired devices are listed and removed under **Settings → Devices** in the web interface.

**Security:** in the local network the connection is plain HTTP. For access from outside, use **Tailscale** (`--bind tailscale`, optionally
`tailscale serve` for https) instead of opening port 47811 to the internet. Open the firewall yourself if needed (`sudo ufw allow 47811/tcp`).

## Everyday use

```bash
autark-headless status     # is the service running?
autark-headless logs       # follow the log (Ctrl+C only ends the view)
autark-headless restart    # restart
autark-headless stop       # stop
autark-headless start      # start
autark-headless version    # installed version
autark-headless wf ...     # the wf command-line tool against this Autark
```

These wrap the normal systemd commands (`systemctl status autark`, `journalctl -u autark -f`; for a desktop install add `--user`). Autark also writes its own
logs in the data folder (`/var/lib/autark/logs`, `~/.local/share/autark/logs`). `--bind` and `--port` live in `autark.env`
(`AUTARK_ARGS="--bind lan --port 47811"`); run `autark-headless restart` after a change.

## Updating

```bash
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | sudo bash -s -- --update
```

(Desktop: without `sudo`.) The script downloads the newest version, switches `current` and restarts the service; your data stays. The previous version stays
under `releases/`; to go back use `--version v0.3.7`. The desktop app's automatic updates (Settings → Updates) do **not** exist in headless mode.

## Removing

```bash
... | sudo bash -s -- --uninstall           # program and service gone, data stays
... | sudo bash -s -- --uninstall --purge   # also all data (and the user autark)
```

## Without the script

```bash
./autark-linux-x64.AppImage --headless                  # data in ~/.local/share/autark
./autark-linux-x64.AppImage --headless --bind lan --data /path/to/data
./autark-linux-x64.AppImage --headless pair             # new code for the running Autark
```

If this fails on a server (sandbox error, missing libraries), extract the AppImage (no FUSE needed) and start the runtime directly:

```bash
./autark-linux-x64.AppImage --appimage-extract
ELECTRON_RUN_AS_NODE=1 ./squashfs-root/autark ./squashfs-root/resources/app.asar/app/runtime-cli.mjs --headless
```

| `--headless` option | Meaning |
| --- | --- |
| `--data FOLDER` | Data folder (default on Linux: `~/.local/share/autark`) |
| `--bind localhost\|lan\|tailscale` | Who can reach it (default: your saved choice; brand new: the local network) |
| `--port N` | Port (default 47811; if taken, the next free one) |
| `--no-pair` | Print no pairing link at start |
| `--log` | Also show Autark's log in the console |

If another Autark already runs on the same data folder, a second start exits with code **3** ("already runs").

## Building the Linux packages

`apps/desktop/package.json` (`build.linux`) lists an `AppImage` for x64 (`autark-linux-x64.AppImage`, used by desktop updates) and a `tar.gz` for x64 and
arm64 (for servers). On Linux: `cd apps/desktop && npm ci && npm run build && npx electron-builder --linux --publish never`, then upload the files with a
`SHA256SUMS.txt`. On Windows only the `tar.gz` can be built (about 10 minutes); it lacks the Unix execute bit (the install script sets it) and carries the
Windows speech module instead of the Linux one, so local speech recognition does not work in such a package. The AppImage cannot be built on Windows
(symlink error). Build a full release on Linux.
