// AF-025: one runtime per data folder. A headless start whose folder already has a running runtime (the service, or a
// second `--headless` by hand) stops with exit code EXIT_ALREADY_RUNNING instead of opening the same database twice;
// the systemd units do not restart on that code (RestartPreventExitStatus).
// runtime.json is the runtime's own note (main.ts); it counts only while its process lives AND its port answers, so a
// note left by a crash – whose pid the OS may since have given to another process – never blocks a start.
// Owns: that check. Never: stops or signals the other process, or uses the token of the note.

import net from 'node:net';
import { processAlive, readRuntimeNote } from './local-runtime.ts';

export const EXIT_ALREADY_RUNNING = 3;

export interface GuardDeps {
  readFile?(file: string): string;
  alive(pid: number): boolean;
  /** True when something accepts a TCP connection on 127.0.0.1:port. */
  answers(port: number): Promise<boolean>;
}

function portAnswers(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export const nodeGuardDeps: GuardDeps = { alive: processAlive, answers: portAnswers };

/** The running runtime of this data folder ({pid, port}), or undefined when none runs there. */
export async function runningRuntime(dataDir: string, deps: GuardDeps = nodeGuardDeps): Promise<{ pid?: number; port: number } | undefined> {
  const note = readRuntimeNote(dataDir, deps.readFile);
  if (!note) return undefined;
  if (note.pid !== undefined && (note.pid === process.pid || !deps.alive(note.pid))) return undefined;
  if (!(await deps.answers(note.port))) return undefined;
  return { pid: note.pid, port: note.port };
}
