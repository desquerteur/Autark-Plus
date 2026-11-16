// RPC contract part (connectors, shared/model/apps.ts). Connectors are files the AI edits (<data>/connectors/,
// skill connect-apps); the Settings UI uses named mutations and reads redacted state. Handlers:
// runtime/rpc/handlers/connected-apps.ts, delegating to services.apps ('unavailable' while it is missing).
// Merged into Methods by module augmentation (methods.ts is at its size limit).
// Owns: these method shapes. Never: behaviour.

import type { ConnectedApp } from '../model/apps.ts';

declare module '../api/methods.ts' {
  interface Methods {
    /** Every connector with its state (no tokens, no header or env values). */
    'apps.list': { params: void; result: ConnectedApp[] };
    /** Connects again; an MCP server that needs a sign-in opens it in the system browser ('waiting'). */
    'apps.reconnect': { params: { id: string; name?: string; transport?: 'http' | 'stdio' | 'mail' }; result: ConnectedApp };
    'apps.setEnabled': { params: { id: string; name: string; transport: 'http' | 'stdio' | 'mail'; enabled: boolean }; result: void };
    'apps.remove': { params: { id: string; name: string; transport: 'http' | 'stdio' | 'mail' }; result: void };
    'apps.setToken': { params: { id: string; name: string; transport: 'http'; secretId: string }; result: void };
    /** Preflight the entire MCP batch before the UI stores any pasted secrets. Writes and connects nothing. */
    'apps.validateAdd': { params: { entries: Array<{ name: string; entry: Record<string, unknown> }> }; result: void };
    'apps.add': { params: { entries: Array<{ name: string; entry: Record<string, unknown> }> }; result: void };
  }
}

export {};
