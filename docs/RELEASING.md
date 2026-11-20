# Releasing Autark-Plus

Every release ships **Windows, Linux (x64 + arm64) and the signed Android APK**, each with SHA-256 checksums.

## One command (release PC)

```powershell
git tag vX.Y.Z            # on the commit to release; the integrator pushes it to desquerteur/Autark-Plus
                          # before -Publish (gh --verify-tag needs it there)
pwsh scripts/release/release-all.ps1 -Tag vX.Y.Z -Publish
```

It sets the version from the tag (desktop `package.json`, Android `versionName`/`versionCode`), then builds:

| Platform | Files | Built by |
|---|---|---|
| Windows x64 | `autark-windows-x64.exe` (+ `.blockmap`, `latest.yml`) | `npm run package -- --win --x64` |
| Linux x64 / arm64 | `autark-linux-<arch>.tar.gz` (what `scripts/install-headless.sh` downloads), `autark-linux-x64.AppImage`, `autark-linux-amd64.deb` / `autark-linux-arm64.deb` (deb names x64 `amd64`), `latest-linux.yml`, `latest-linux-arm64.yml` | `scripts/release/build-linux.sh` in WSL Ubuntu 24.04 |
| Android | `autark-android.apk`, `latest-android.json` | `apps/android/build.ps1 -Release` |

and writes `SHA256SUMS.txt` and `release.json` over all of them into `.local/release/<tag>/`. With `-Publish` it creates the
GitHub release (needs `gh` signed in or `GH_TOKEN`) and uploads everything. `-Skip windows|linux|android` leaves a platform out.

Requirements on the release PC: Node 24, JDK 21, Android SDK (`%LOCALAPPDATA%\Android\Sdk`), WSL distro `Ubuntu-24.04`
with `scripts/release/wsl-setup.sh` run once as root, `gh`.

## CI

`.github/workflows/build-desktop.yml` builds the desktop packages on a pushed `v*` tag once GitHub Actions can run. Until then
the local command above is the release path. macOS is built by CI only.

## Android signing

The APK is signed with a release key that lives **outside the repository**: `%USERPROFILE%\.autark-release\android`
(made once by `apps/android/new-release-key.ps1`, RSA 4096, 30 years, alias `autark`). A backup is in the team's secrets catalog
(`AUTARK_ANDROID_KEYSTORE_BASE64`, `AUTARK_ANDROID_KEYSTORE_PASSWORD`). Never replace it: phones with an installed APK only
accept updates signed with the same key. Windows and Linux packages are not code-signed (SHA-256 checksums only).

## Checks before publishing

Windows installer installs and starts; `build-linux.sh` itself fails on a package for the wrong CPU or without the
arm64 voice add-on; `scripts/release/test-headless-install.sh` passes as root on fresh Debian and Ubuntu (WSL distros with
systemd, files served by a local mirror via `AUTARK_DOWNLOAD_BASE`); the APK installs on an emulator or
phone (`adb install`). `docs/headless-linux.md` covers the server install.
