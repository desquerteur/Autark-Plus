# Releasing Autark-Plus

Every release ships **Windows, Linux (x64 + arm64) and the signed Android APK**, each with SHA-256 checksums.

## One command (release PC)

```powershell
git tag vX.Y.Z            # on the commit to release (do not push it before the build passed)
pwsh scripts/release/release-all.ps1 -Tag vX.Y.Z -Publish
```

It sets the version from the tag (desktop `package.json`, Android `versionName`/`versionCode`), then builds:

| Platform | Files | Built by |
|---|---|---|
| Windows x64 | `autark-windows-x64.exe` (+ `.blockmap`, `latest.yml`) | `npm run package -- --win --x64` |
| Linux x64 / arm64 | `autark-linux-<arch>.tar.gz` (what `scripts/install-headless.sh` downloads), `autark-linux-x64.AppImage`, `autark-linux-<arch>.deb`, `latest-linux.yml` | `scripts/release/build-linux.sh` in WSL Ubuntu 24.04 |
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

Windows installer installs and starts; Linux tarball passes `install-headless.sh --file`; the APK installs on an emulator or
phone (`adb install`). `docs/headless-linux.md` covers the server install.
