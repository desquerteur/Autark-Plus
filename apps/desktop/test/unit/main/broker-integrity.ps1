# Owns: isolated tests of the real install functions. Never: executes the installer or touches SCM/files/ACLs.
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'resources/broker/install.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
  Invoke-Expression $fn.Extent.Text
}
$trusted = @('S-1-5-18', 'S-1-5-32-544')
$store = 'C:\Program Files\AutarkDesktopBroker'
function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
  try { & $Action } catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
  throw "Expected failure: $Pattern"
}
function Get-Item {
  param($LiteralPath, [switch]$Force)
  if ($LiteralPath -eq 'leaf') { return $script:leaf }
  return $script:parent
}
function Get-Acl {
  param($LiteralPath)
  $value = [pscustomobject]@{ OwnerSid = $script:owner; Rules = $script:rules }
  $value | Add-Member ScriptMethod GetOwner { param($type) [Security.Principal.SecurityIdentifier]::new($this.OwnerSid) }
  $value | Add-Member ScriptMethod GetAccessRules { param($a,$b,$c) $this.Rules }
  return $value
}
function Rule($sid, $rights, $propagation = 'None') {
  [pscustomobject]@{AccessControlType='Allow';PropagationFlags=[Security.AccessControl.PropagationFlags]$propagation;IdentityReference=[Security.Principal.SecurityIdentifier]::new($sid);FileSystemRights=$rights}
}
$leaf = [pscustomobject]@{ FullName='leaf'; Attributes=0; PSIsContainer=$false; Directory=$null }
$owner='S-1-5-32-544'; $rules=@((Rule 'S-1-5-32-544' 0x1f01ff))
Assert-TrustedPath leaf
$owner='S-1-5-21-1-2-3-1001'
Expect-Failure { Assert-TrustedPath leaf } 'Untrusted owner'
$owner='S-1-5-32-544'; $rules=@((Rule 'S-1-5-32-545' 2))
Expect-Failure { Assert-TrustedPath leaf } 'Writable path'
$rules=@((Rule 'S-1-5-32-545' 0x1f01ff 'InheritOnly'))
Assert-TrustedPath leaf
$leaf.Attributes=[IO.FileAttributes]::ReparsePoint
Expect-Failure { Assert-TrustedPath leaf } 'Reparse point'
$leaf.Attributes=0
$parent=[pscustomobject]@{FullName='parent';Attributes=[IO.FileAttributes]::ReparsePoint;PSIsContainer=$true;Parent=$null}
$leaf.Directory=$parent; $rules=@()
Expect-Failure { Assert-TrustedPath leaf } 'Reparse point'
$parent.Attributes=0; $rules=@((Rule 'S-1-5-32-545' 64))
Expect-Failure { Assert-TrustedPath leaf } 'Writable path'
$leaf.Directory=$null
Expect-Failure { Assert-ProtectedImage 'C:\Users\me\AutarkDesktopBroker.exe' } 'outside protected'
Expect-Failure { Image-Parts ([pscustomobject]@{PathName='unquoted.exe service S-1-5-18'}) } 'Unrecognized'
$parts=Image-Parts ([pscustomobject]@{PathName='"C:\old broker.exe" service S-1-5-21-1-2-3-1001'})
if ($parts[1] -ne 'S-1-5-21-1-2-3-1001') { throw 'SID not preserved' }
Write-Output 'PASS: trusted ACL; owner/write/inherit-only; leaf/ancestor reparse; delete-child; unsafe image; malformed command; SID'
$name='AutarkDesktopBroker'
function Get-CimInstance { return [pscustomobject]@{ PathName=$null; StartName=$null; State='Running' } }
function Get-ItemProperty { return [pscustomobject]@{ ImagePath='"C:\protected.exe" service S-1-5-18'; ObjectName='LocalSystem' } }
$info=Service-Info
if ($info.PathName -ne '"C:\protected.exe" service S-1-5-18' -or $info.StartName -ne 'LocalSystem' -or $info.State -ne 'Running') { throw 'Partial CIM fallback failed' }
function Get-ItemProperty { throw 'registry unreadable' }
Expect-Failure { Service-Info } 'registry unreadable'
function Get-ItemProperty { return [pscustomobject]@{} }
Expect-Failure { Service-Info } 'configuration is unreadable'
Write-Output 'PASS: partial CIM uses read-only registry; missing/unreadable registry fails closed'
