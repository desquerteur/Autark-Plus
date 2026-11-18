// How a Claude Code turn starts (B-049 F2): our system prompt in place of Claude Code's, its built-in tools cut to the
// execution core, our hub for everything else. Every turn runs this way; a CLI too old for these flags fails the turn.
// - `--system-prompt-file`: our stable prompt only. The live context never goes there – it is the first block of the
//   turn's input (shared.ts contextText), so every session of an agent starts with the same cached system text.
// - `--tools`: an agent turn keeps Bash, Read, Edit, Write, Glob, Grep, WebSearch (+ PowerShell on Windows, Claude Code's
//   shell there); a helper turn none (`--json-schema` keeps its answer tool, measured 02.11.2026). E1: WebSearch is the
//   plan's own search; web.fetch reads a page, so WebFetch stays out.
// - `--disable-slash-commands`, `--settings {"disableAllHooks":true}`: no skills, commands or hooks; nothing is widened.
// - LEAN_ENV: no CLAUDE.md of any level, no auto memory, no git workflow text. AGENT_ENV (an agent turn only): the prompt
//   cache is asked for one hour, whatever login the account has.
// - The hub entry loads its tools upfront (`alwaysLoad`) and a hub call runs up to HUB_CALL_MS.
// What Claude Code still adds on its own (run1 recording 12.11.2026, 2.1.322, 191 requests): a billing header and its
// identity line ("You are a Claude agent, built on Anthropic's Claude Agent SDK.") as two system blocks before ours; a
// '# Environment' message (folder, platform, shell, model, date); the account's e-mail as a reminder in the first message;
// later "The user hasn't heard from you" nudges, background-task notices, '# Environment update' messages and file-changed
// notes; DeferredToolPlaceholder and about 18–21K characters of built-in tool text (PowerShell alone about 9K).
// Not switched on (2.1.323, read offline from the binary, not run): CLAUDE_CODE_DISABLE_ATTACHMENTS turns off Claude Code's
// attachment layer, which also carries lines steered into a running turn (queued_command) – unproven that steering survives;
// the e-mail comes from the session context, which only bare mode drops (bare signs in by API key only);
// CLAUDE_CODE_SILENT_TURN_REMINDER overrides the nudge gate – how it parses "0" is unverified.
// Owns: the start arguments, environment and hub config. Never: widens what a turn may do or drops the hub.

import { HUB_SERVER } from './stream.ts';

/** Claude Code's built-in tools an agent turn keeps: the execution core and its own web search. Everything else comes from our hub. */
export const CORE_TOOLS: readonly string[] = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch'];

/** The core for this platform: Windows adds PowerShell, Claude Code's shell there (on by default for claude.ai logins). */
export function coreTools(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? [...CORE_TOOLS, 'PowerShell'] : [...CORE_TOOLS];
}

/**
 * Every turn process: no CLAUDE.md, no auto memory, no built-in git workflow text (documented variables). B-080: no compact
 * window of ours (the owner rejected a fixed threshold, 08.11.2026) – Claude Code keeps its own, as in the plain CLI.
 */
export const LEAN_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1',
};

/**
 * An agent turn's process on top of LEAN_ENV (KI-Runde 17.11.2026): its session rests up to an hour between turns and is read
 * again whole on every call, so its cache is asked for one hour (Claude Code 2.1.242+). On a plan login that is Claude Code's own
 * default for the main conversation (measured 15.–17.11.2026: all 15,807 calls asked for one hour); on an API-key login it
 * would be five minutes. A helper turn is never resumed and keeps the default.
 */
export const AGENT_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' };

/** Session settings of every turn (`--settings`): only narrowing keys. */
export const LEAN_SETTINGS = '{"disableAllHooks":true}';

/** The prompt and tool flags: our prompt file (none: Claude Code's own), exactly `tools` (none for a helper turn), no commands, no hooks. */
export function promptArgs(promptFile: string | undefined, tools: readonly string[]): string[] {
  return [...(promptFile ? ['--system-prompt-file', promptFile] : []), '--tools', tools.join(','), '--disable-slash-commands', '--settings', LEAN_SETTINGS];
}

/**
 * The hub entry's `timeout`: without it Claude Code 2.1.303 cuts a hub call after 60 s ("The operation timed out.", live 02.11.2026), while the
 * call goes on here. A tool's own limit and the stall watch stay what ends a call that hangs.
 */
export const HUB_CALL_MS = 60 * 60_000;

/** The hub's MCP config file text: its tools load upfront and startup waits for them (alwaysLoad). */
export function hubConfig(mcp: { url: string; token: string }): string {
  const server = { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` }, timeout: HUB_CALL_MS, alwaysLoad: true };
  return JSON.stringify({ mcpServers: { [HUB_SERVER]: server } });
}
