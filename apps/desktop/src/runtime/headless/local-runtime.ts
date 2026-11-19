// AF-025: the headless runtime of a data folder as another process sees it: its note <data>/runtime.json
// {port, token, pid} (written by main.ts once it listens, 0600) and one RPC call over its loopback WebSocket with that
// owner token – for `pair` (pair-command.ts) and the one-runtime-per-folder check (guard.ts). wf has its own client
// (wf-cli is a separate bundle that nothing imports).
// Owns: reading the note and that single call. Never: prints, logs or returns the token, or sends it to a port whose
// process is gone.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isResponse, PROTOCOL_VERSION } from '../../shared/api/protocol.ts';

export const RUNTIME_FILE = 'runtime.json';

export interface RuntimeNote {
  port: number;
  token: string;
  pid?: number;
}

/** {port, token, pid?} from runtime.json text; undefined when anything is off. */
export function parseRuntimeNote(text: string): RuntimeNote | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { port, token, pid } = value as Record<string, unknown>;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (typeof token !== 'string' || !token || token.length > 512) return undefined;
  if (pid !== undefined && (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1)) return undefined;
  return { port, token, ...(pid === undefined ? {} : { pid }) };
}

/** The note of this data folder, or undefined when there is none (or it is unreadable). */
export function readRuntimeNote(dataDir: string, readFile: (file: string) => string = (file) => readFileSync(file, 'utf8')): RuntimeNote | undefined {
  try { return parseRuntimeNote(readFile(path.join(dataDir, RUNTIME_FILE))); } catch { return undefined; }
}

/** process.kill(pid, 0): ESRCH = gone; EPERM = exists but belongs to another user. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(text: string): void;
  close(code?: number): void;
}
export type SocketFactory = (url: string) => SocketLike;

function globalSocket(url: string): SocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  if (!Ctor) throw new Error('This Node.js has no WebSocket client.');
  return new Ctor(url);
}

/** One owner-scope call on the runtime of `note`; rejects with the runtime's message, a closed socket or a timeout. */
export function callRuntime(note: RuntimeNote, method: string, params: unknown, options: { socket?: SocketFactory; timeoutMs?: number } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = (options.socket ?? globalSocket)(`ws://127.0.0.1:${note.port}/ws`);
    const finish = (error: Error | undefined, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(1000); } catch { /* already closed */ }
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`The runtime on port ${note.port} did not answer.`)), options.timeoutMs ?? 15_000);
    timer.unref?.();
    ws.onerror = () => { /* the close event decides */ };
    ws.onclose = (event) => finish(new Error(event.code === 4401 ? 'The runtime refused the token of runtime.json.' : `Nothing answers on port ${note.port}. Is Autark still running?`));
    ws.onopen = () => {
      ws.send(JSON.stringify({ protocol: PROTOCOL_VERSION, token: note.token, client: 'cli' }));
      ws.send(JSON.stringify({ id: 1, method, params }));
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let frame: unknown;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (!isResponse(frame) || frame.id !== 1) return;
      if (frame.error) finish(new Error(frame.error.message || frame.error.code));
      else finish(undefined, frame.result ?? null);
    };
  });
}
