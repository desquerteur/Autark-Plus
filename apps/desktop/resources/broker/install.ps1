# Owns: elevated broker installation/migration into an admin-controlled, hash-addressed directory.
# Never: runs a user-writable service image, rotates an existing key, or rolls back to an unsafe image.
param([switch]$Uninstall, [switch]$Check, [string]$AppExe, [string]$UserSid, [switch]$Elevated)
$ErrorActionPreference = 'Stop'
$name = 'AutarkDesktopBroker'
$store = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) $name
$dataDir = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) $name
$trusted = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')

function Assert-TrustedPath([string]$Path, [switch]$Ancestor) {
  $item = Get-Item -LiteralPath $Path -Force
  $leaf = -not $Ancestor
  while ($item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point: $($item.FullName)" }
    $acl = Get-Acl -LiteralPath $item.FullName
    if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw "Untrusted owner: $($item.FullName)" }
    # Ancestors: no replacement of children. Leaf: no writes. Inherit-only ACEs do not apply here.
    $mask = if ($leaf) { 0xD0156 } else { 0xD0040 }
    foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($ace.AccessControlType -eq 'Allow' -and -not ($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
          $trusted -notcontains $ace.IdentityReference.Value -and ([int]$ace.FileSystemRights -band $mask)) {
        throw "Writable path: $($item.FullName)"
      }
    }
    $leaf = $false
    $item = if ($item.PSIsContainer) { $item.Parent } else { $item.Directory }
  }
}
function New-ProtectedDirectory([string]$Path, [switch]$PublicRead) {
  if (Test-Path -LiteralPath $Path) { Assert-TrustedPath $Path; return }
  Assert-TrustedPath (Split-Path -Parent $Path) -Ancestor
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  if ($PublicRead) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  [IO.Directory]::CreateDirectory($Path, $acl) | Out-Null
  Assert-TrustedPath $Path
}
function Service-Info {
  $info = Get-CimInstance Win32_Service -Filter "Name='$name'"
  # WMI can redact configuration with a read-only service DACL. Read the same SCM
  # configuration from HKLM instead of granting the user service-control rights.
  if ($info -and (-not $info.PathName -or -not $info.StartName)) {
    $config = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$name" -ErrorAction Stop
    if (-not $config.ImagePath -or -not $config.ObjectName) { throw 'Broker configuration is unreadable.' }
    return [pscustomobject]@{ PathName=$config.ImagePath; StartName=$config.ObjectName; State=$info.State }
  }
  return $info
}
function Set-AdminOwner([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Image-Parts($Service) {
  if ($Service -and $Service.PathName -match '^"([^"]+)" service (S-1-[0-9-]+)$') { return @($Matches[1], $Matches[2]) }
  if ($Service) { throw 'Unrecognized broker command; inspect it before migration.' }
}
function Assert-ProtectedImage([string]$Image) {
  if ($Image -notmatch ('^' + [regex]::Escape($store) + '\\[A-Fa-f0-9]{64}\\AutarkDesktopBroker\.exe$')) { throw 'Service image outside protected store.' }
  Assert-TrustedPath $Image
  if ((Get-FileHash -LiteralPath $Image -Algorithm SHA256).Hash -ne (Split-Path (Split-Path $Image) -Leaf)) { throw 'Stored broker hash mismatch.' }
}
function Change-Image([string]$Command) {
  $result = Invoke-CimMethod -InputObject (Service-Info) -MethodName Change -Arguments @{ PathName = $Command; StartName = 'LocalSystem'; StartMode = 'Automatic' }
  if ($result.ReturnValue -ne 0) { throw "Service Change failed ($($result.ReturnValue))" }
}
function Stop-Broker {
  $service = Get-Service $name -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service $name
    (Get-Service $name).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
  }
}

$old = $null; $oldParts = $null; $rollback = $false; $changed = $false; $created = $false
try {
  $old = Service-Info
  $oldParts = Image-Parts $old
  if ($oldParts) { $UserSid = $oldParts[1] } # Preserve pipe identity across over-the-shoulder UAC.
  if (-not $UserSid) { $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
  $null = New-Object Security.Principal.SecurityIdentifier($UserSid)
  $source = Join-Path $PSScriptRoot "$name.exe"
  if (-not $Uninstall) {
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $versionDir = Join-Path $store $hash
    $exe = Join-Path $versionDir "$name.exe"
    $command = "`"$exe`" service $UserSid"
  }
  if (-not $Uninstall -and $old -and $old.PathName -eq $command -and $old.StartName -eq 'LocalSystem' -and $old.State -eq 'Running') {
    try {
      Assert-ProtectedImage $exe
      Assert-TrustedPath $dataDir
      Assert-TrustedPath (Join-Path $dataDir 'broker.key')
      exit 0
    } catch { if ($Check) { throw } }
  }
  if ($Check) { exit 2 }
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated', '-UserSid', $UserSid)
    if ($AppExe) { $arguments += @('-AppExe', "`"$AppExe`"") }
    if ($Uninstall) { $arguments += '-Uninstall' }
    # Process.Start, not Start-Process: Start-Process drops the Win32 error code that tells a No at the Windows prompt apart.
    $elevate = New-Object Diagnostics.ProcessStartInfo 'powershell.exe'
    $elevate.Arguments = $arguments -join ' '
    $elevate.Verb = 'runas'
    $elevate.UseShellExecute = $true
    $elevate.WindowStyle = 'Hidden'
    try { $process = [Diagnostics.Process]::Start($elevate) }
    catch {
      # The person answered the Windows prompt with No: ERROR_CANCELLED (1223) is the exit code main/broker-setup.ts reads.
      $cause = $_.Exception
      while ($cause -and -not ($cause -is [ComponentModel.Win32Exception])) { $cause = $cause.InnerException }
      if ($cause -and $cause.NativeErrorCode -eq 1223) { exit 1223 }
      throw
    }
    $process.WaitForExit()
    exit $process.ExitCode
  }
  $mutex = New-Object Threading.Mutex($false, 'Global\AutarkDesktopBroker.Install')
  if (-not $mutex.WaitOne(0)) { throw 'Another broker setup is running.' }
  try {
    if ($Uninstall) {
      if (Test-Path -LiteralPath $store) { Assert-TrustedPath $store }
      if (Test-Path -LiteralPath $dataDir) { Assert-TrustedPath $dataDir }
      Stop-Broker
      if ($old) { & sc.exe delete $name | Out-Null; if ($LASTEXITCODE) { throw 'Service delete failed.' } }
      # Retain protected data/versions for explicit admin cleanup, not recursive traversal of unknown children.
      Remove-NetFirewallRule -DisplayName 'Autark' -ErrorAction SilentlyContinue
      Write-Output "Service removed. Protected data and versions retained at $dataDir and $store."
    } else {
      New-ProtectedDirectory $store -PublicRead
      New-ProtectedDirectory $versionDir -PublicRead
      if (-not (Test-Path -LiteralPath $exe)) {
        $inputFile = [IO.File]::OpenRead($source)
        try {
          $outputFile = New-Object IO.FileStream($exe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
          try { $inputFile.CopyTo($outputFile) } finally { $outputFile.Dispose() }
        } finally { $inputFile.Dispose() }
        Set-AdminOwner $exe
      }
      Assert-ProtectedImage $exe
      New-ProtectedDirectory $dataDir
      $keyPath = Join-Path $dataDir 'broker.key'
      if (Test-Path -LiteralPath $keyPath) { Assert-TrustedPath $keyPath }
      elseif ($old) { throw 'Existing service has no key; explicit recovery required.' }
      else {
        $key = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($key); [IO.File]::WriteAllText($keyPath, [Convert]::ToBase64String($key)) }
        finally { [Array]::Clear($key, 0, $key.Length); $rng.Dispose() }
        Set-AdminOwner $keyPath
      }
      # Replace complete directory DACL; existing key bytes are unchanged.
      $acl = Get-Acl -LiteralPath $dataDir
      foreach ($ace in @($acl.Access)) { $null = $acl.RemoveAccessRuleSpecific($ace) }
      foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', $UserSid)) {
        $rights = if ($sid -eq $UserSid) { 'ReadAndExecute' } else { 'FullControl' }
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
      }
      Set-Acl -LiteralPath $dataDir -AclObject $acl
      Assert-TrustedPath $keyPath
      if ($oldParts) { try { Assert-ProtectedImage $oldParts[0]; $rollback = $true } catch { $rollback = $false } }
      Stop-Broker
      $changed = $true
      if ($old) { Change-Image $command }
      else { New-Service -Name $name -BinaryPathName $command -StartupType Automatic -DisplayName 'Autark Desktop Broker' | Out-Null; $created = $true }
      & sc.exe sdset $name "D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;CCLCRC;;;$UserSid)" | Out-Null
      if ($LASTEXITCODE) { throw 'Service ACL failed.' }
      & sc.exe failure $name reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
      if ($LASTEXITCODE) { throw 'Service recovery configuration failed.' }
      Start-Service $name
      (Get-Service $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
      if ($AppExe) {
        try {
          Remove-NetFirewallRule -DisplayName 'Autark' -ErrorAction SilentlyContinue
          New-NetFirewallRule -DisplayName 'Autark' -Direction Inbound -Program $AppExe -Action Allow -Profile Any | Out-Null
        } catch { Write-Warning "Firewall rule not set: $($_.Exception.Message)" }
      }
      Write-Output "Broker installed: $exe (user $UserSid)."
    }
  } finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
} catch {
  Write-Output "FAILED: $($_.Exception.Message)"
  if ($changed) {
    try {
      Stop-Broker
      if ($rollback) { Change-Image $old.PathName; if ($old.State -eq 'Running') { Start-Service $name } }
      elseif ($created) { & sc.exe delete $name | Out-Null }
      else { Set-Service $name -StartupType Disabled }
    } catch { Write-Output "Recovery requires administrator: $($_.Exception.Message)" }
  }
  exit 1
}
exit 0
