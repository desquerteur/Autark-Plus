// Owns: the Windows external-process quiescence gate. Never: emits raw command lines or credentials.
// Narrow Windows operating gate, not a lock on arbitrary external tools. All native Claude
// processes and node-launched Claude wrappers must be absent. Unknown inventory fails closed.
// Raw command lines are examined ONLY inside PowerShell, never returned/logged to the runtime.
import { randomUUID } from 'node:crypto';
import type { Supervisor } from '../system/supervisor.ts';
import { conflict } from './home-owner.ts';
export interface ProcessQuiescence { probeId: string; at: number; runtimeBoot: string; pids: number[] }
export async function probeClaudeQuiescence(supervisor: Supervisor, runtimeBoot: string, options: { platform?: NodeJS.Platform; timeoutMs?: number } = {}): Promise<ProcessQuiescence> {
  if ((options.platform ?? process.platform) !== 'win32') return conflict('External Claude process inventory is supported only on Windows.');
  const script = String.raw`$ErrorActionPreference='Stop'; try { $hits=@(); $unknown=$false; Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { $n=$_.Name; if ($n -match '^(claude|claude-code)(\.exe)?$') { $hits += [int]$_.ProcessId }; if ($n -match '^node(\.exe)?$') { if ([string]::IsNullOrWhiteSpace($_.CommandLine)) { $unknown=$true } elseif ($_.CommandLine -match '(?i)claude|anthropic[\\/]claude-code') { $hits += [int]$_.ProcessId } } }; @{ known=(-not $unknown); pids=@($hits) } | ConvertTo-Json -Compress } catch { '{"known":false,"pids":[]}' ; exit 1 }`;
  const lease = supervisor.spawn({ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], owner: 'claude-quiescence', kind: 'light', env: { ...process.env, CLAUDE_CONFIG_DIR: undefined } });
  let output = '';
  lease.child.stdout?.on('data', chunk => { if (output.length < 16_384) output += String(chunk); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let code: number | null;
  try { code = await Promise.race([lease.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Claude process inventory did not answer.')), options.timeoutMs ?? 15_000); timer.unref?.(); })]); } finally { if (timer) clearTimeout(timer); }
  let result: { known?: boolean; pids?: number[] };
  try { result = JSON.parse(output); } catch { return conflict('Claude process inventory unknown.'); }
  if (code !== 0 || result.known !== true || !Array.isArray(result.pids) || result.pids.length || result.pids.some(pid => !Number.isInteger(pid))) return conflict('Claude process/home quiescence is not proven; wait for all external Claude CLIs to finish.');
  return { probeId: randomUUID(), at: Date.now(), runtimeBoot, pids: [] };
}
