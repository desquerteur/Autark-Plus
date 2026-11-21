# Owns: read-only installer preflight, embedded in the NEW setup (not loaded from the old app).
# Never: starts, stops or changes the broker. A legacy/unknown service requires explicit migration first.
$ErrorActionPreference = 'Stop'
try {
  $service = Get-CimInstance Win32_Service -Filter "Name='AutarkDesktopBroker'"
  # Read-only fallback when WMI redacts configuration under the service DACL.
  if ($service -and (-not $service.PathName -or -not $service.StartName)) {
    $config = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\AutarkDesktopBroker' -ErrorAction Stop
    if (-not $config.ImagePath -or -not $config.ObjectName) { throw 'Broker configuration is unreadable.' }
    $service = [pscustomobject]@{ PathName=$config.ImagePath; StartName=$config.ObjectName }
  }
  $store = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AutarkDesktopBroker'
  if ($service -and ($service.StartName -ne 'LocalSystem' -or
      $service.PathName -notmatch ('^"' + [regex]::Escape($store) + '\\[A-Fa-f0-9]{64}\\AutarkDesktopBroker\.exe" service S-1-[0-9-]+$'))) { exit 2 }
  exit 0
} catch { exit 3 }
