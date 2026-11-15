// Owns: non-elevated broker script regression checks. Never: starts the actual install script or a service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('broker path/ACL functions reject unsafe owners, writes and reparse ancestors', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'test/unit/main/broker-integrity.ps1'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS:/);
});

test('broker lifecycle keeps key/SID, stages before stop, and only rolls back to a validated protected image', () => {
  const script = readFileSync('resources/broker/install.ps1', 'utf8');
  const stage = script.indexOf('New-ProtectedDirectory $store');
  assert.ok(script.indexOf('Assert-ProtectedImage $exe', stage) < script.indexOf('      Stop-Broker', stage));
  assert.match(script, /if \(\$oldParts\) \{ \$UserSid = \$oldParts\[1\]/);
  assert.match(script, /if \(Test-Path -LiteralPath \$keyPath\) \{ Assert-TrustedPath \$keyPath \}/);
  assert.match(script, /Assert-ProtectedImage \$oldParts\[0\]; \$rollback = \$true/);
  assert.match(script, /else \{ Set-Service \$name -StartupType Disabled \}/);
  assert.doesNotMatch(script, /ResultFile|Remove-Item -Recurse|RPWP/);
});

test('embedded preflight accepts absent/protected services and refuses legacy, malformed and query failure', { skip: process.platform !== 'win32' }, () => {
  const protectedPath = `'"' + [Environment]::GetFolderPath('ProgramFiles') + '\\AutarkDesktopBroker\\' + ('A' * 64) + '\\AutarkDesktopBroker.exe" service S-1-5-21-1-2-3-1001'`;
  const cases: Array<[string, number, string?]> = [
    ['return $null', 0],
    [`return [pscustomobject]@{ StartName='LocalSystem'; PathName='"' + [Environment]::GetFolderPath('ProgramFiles') + '\\AutarkDesktopBroker\\' + ('A' * 64) + '\\AutarkDesktopBroker.exe" service S-1-5-21-1-2-3-1001' }`, 0],
    [`return [pscustomobject]@{ StartName='LocalSystem'; PathName='"C:\\Users\\me\\broker.exe" service S-1-5-18' }`, 2],
    [`return [pscustomobject]@{ StartName='LocalSystem'; PathName='malformed' }`, 2],
    [`throw 'query failed'`, 3],
    [`return [pscustomobject]@{ PathName=$null; StartName=$null }`, 0, `return [pscustomobject]@{ ImagePath=${protectedPath}; ObjectName='LocalSystem' }`],
    [`return [pscustomobject]@{ PathName=$null; StartName=$null }`, 2, `return [pscustomobject]@{ ImagePath='legacy.exe'; ObjectName='LocalSystem' }`],
    [`return [pscustomobject]@{ PathName=$null; StartName=$null }`, 3, `throw 'registry unreadable'`],
    [`return [pscustomobject]@{ PathName=$null; StartName=$null }`, 3, `return [pscustomobject]@{}`],
  ];
  for (const [body, status, registry = "throw 'unexpected registry read'"] of cases) {
    const command = Buffer.from(`$ProgressPreference='SilentlyContinue'; function Get-CimInstance { ${body} }; function Get-ItemProperty { ${registry} }; & ./resources/broker/preflight.ps1; exit $LASTEXITCODE`, 'utf16le').toString('base64');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, status, result.stdout + result.stderr);
  }
});
