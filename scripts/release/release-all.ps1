# Owns: building every platform of one Autark release on the release PC and (with -Publish) attaching it to the GitHub release:
#   Windows x64 installer, Linux x64 + arm64 (tar.gz for install-headless.sh, AppImage, deb) built in WSL Ubuntu,
#   the signed Android APK, update feeds, SHA256SUMS.txt and release.json. One command per release:
#       pwsh scripts/release/release-all.ps1 -Tag v0.3.10 -Publish
# CI (.github/workflows/build-desktop.yml) does the same on tag push once GitHub Actions runs; this is the path that works
# without it. Details: docs/RELEASING.md.
# Never: pushes branches or tags, signs with a key that is not outside the repository, or publishes a release that a
# platform failed for.
param(
    [Parameter(Mandatory)][ValidatePattern('^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')][string]$Tag,
    [ValidateSet('windows', 'linux', 'android')][string[]]$Skip = @(),
    [switch]$Publish,                       # create/update the GitHub release (needs GH_TOKEN or `gh auth login`)
    [string]$Repo = 'desquerteur/Autark-Plus',
    [string]$WslDistro = 'Ubuntu-24.04'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$version = $Tag.Substring(1)
$out = Join-Path $root ".local/release/$Tag"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null
$desktop = Join-Path $root 'apps/desktop'

function Run([string]$what, [scriptblock]$block) {
    Write-Output "==> $what"
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

# ---- versions: the tag is the truth (desktop package.json, Android versionName/versionCode)
Push-Location $desktop
try { npm version $version --no-git-tag-version --allow-same-version | Out-Null } finally { Pop-Location }
$gradle = Join-Path $root 'apps/android/app/build.gradle'
$parts = ($version -split '[-]')[0] -split '\.'
$code = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
$text = [IO.File]::ReadAllText($gradle)
$text = $text -replace "(?m)^(\s*versionCode = )\d+", "`${1}$code" -replace "(?m)^(\s*versionName = )'[^']+'", "`${1}'$version'"
[IO.File]::WriteAllText($gradle, $text)

# ---- Windows
if ('windows' -notin $Skip) {
    Push-Location $desktop
    try {
        Run 'npm ci (Windows)' { npm ci --no-fund --no-audit }
        $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
        Run 'package Windows x64' { npm run package -- --win --x64 }
        foreach ($f in 'autark-windows-x64.exe', 'autark-windows-x64.exe.blockmap', 'latest.yml') {
            Copy-Item -LiteralPath (Join-Path 'dist' $f) -Destination $out
        }
    } finally { Pop-Location }
}

# ---- Linux (WSL: x64 + arm64 in one run)
if ('linux' -notin $Skip) {
    function ToWsl([string]$p) { $d = $p.Substring(0, 1).ToLower(); '/mnt/' + $d + ($p.Substring(2) -replace '\\', '/') }
    $outWsl = ToWsl $out
    Run 'build Linux packages in WSL' {
        wsl -d $WslDistro -u root -- bash "$(ToWsl $root)/scripts/release/build-linux.sh" (ToWsl $root) $version $outWsl
    }
}

# ---- Android (signed with the key outside the repo: ~/.autark-release/android, backup in the secrets catalog)
if ('android' -notin $Skip) {
    if (-not $env:ANDROID_HOME) {
        $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
        if (Test-Path $sdk) { $env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk } else { throw 'ANDROID_HOME is not set and no SDK in %LOCALAPPDATA%\Android\Sdk.' }
    }
    Run 'build signed Android APK' { & (Join-Path $root 'apps/android/build.ps1') -Release }
    $apkDir = Join-Path $root 'apps/android/app/build/outputs/apk/release'
    Copy-Item (Join-Path $apkDir 'autark-android.apk') $out
    $rec = Get-Content (Join-Path $apkDir 'autark-android.json') -Raw | ConvertFrom-Json
    [ordered]@{ versionCode = $rec.versionCode; versionName = $rec.versionName; sha256 = $rec.sha256; url = "https://github.com/$Repo/releases/download/$Tag/autark-android.apk" } |
        ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $out 'latest-android.json')
}

# ---- Checksums + release.json
$files = Get-ChildItem $out -File | Where-Object { $_.Name -notin 'SHA256SUMS.txt', 'release.json' } | Sort-Object Name
$lines = foreach ($f in $files) { '{0}  {1}' -f (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower(), $f.Name }
[IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS.txt'), (($lines -join "`n") + "`n"))
$commit = (git -C $root rev-parse HEAD).Trim()
$meta = [ordered]@{
    version = $version; tag = $Tag; repository = $Repo; commit = $commit; builtOn = 'release PC (local)'
    publishedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); signed = [ordered]@{ android = $true; windows = $false; linux = $false }
    files = @($files | ForEach-Object { [ordered]@{ name = $_.Name; size = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } })
}
[IO.File]::WriteAllText((Join-Path $out 'release.json'), ($meta | ConvertTo-Json -Depth 5) + "`n")
Write-Output "Built into $out :"; Get-ChildItem $out | Select-Object Name, Length | Format-Table | Out-String | Write-Output

# ---- Publish
if ($Publish) {
    $gh = (Get-Command gh -ErrorAction SilentlyContinue)
    if (-not $gh) { throw 'gh (GitHub CLI) is not installed: winget install GitHub.cli, then set GH_TOKEN or run gh auth login.' }
    $notes = Join-Path $root "docs/releases/$Tag.md"
    $exists = $false; gh release view $Tag --repo $Repo *> $null; if ($LASTEXITCODE -eq 0) { $exists = $true }
    if (-not $exists) {
        $args = @('release', 'create', $Tag, '--repo', $Repo, '--title', "Autark $version", '--verify-tag')
        if (Test-Path $notes) { $args += @('--notes-file', $notes) } else { $args += @('--notes', "Autark $version") }
        if ($version -match '-') { $args += '--prerelease' } else { $args += '--latest' }
        Run 'create release' { gh @args }
    }
    Run 'upload assets' { gh release upload $Tag --repo $Repo --clobber @((Get-ChildItem $out -File).FullName) }
    Write-Output "Published: https://github.com/$Repo/releases/tag/$Tag"
}
