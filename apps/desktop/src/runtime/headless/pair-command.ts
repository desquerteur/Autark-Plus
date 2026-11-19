// AF-025: `runtime-cli pair [--data <dir>]` (`autark-headless pair`): a new pairing link and code from the headless
// runtime that runs on this data folder – over its own RPC with the owner token of runtime.json (local-runtime.ts).
// The system service's folder belongs to its own user, so the wrapper runs this as that user.
// Owns: the command's flow and exit code. Never: prints the owner token, or pairs anything.

import { pairingLines, type PairingInfo } from './banner.ts';
import { callRuntime, processAlive, readRuntimeNote, type RuntimeNote } from './local-runtime.ts';
import { flagValue, headlessDataDir, type HeadlessEnv } from './options.ts';

export interface PairIo extends HeadlessEnv {
  print(line: string): void;
  error(line: string): void;
  now(): number;
  qr?(text: string): Promise<string>;
  /** Defaults: runtime.json of the folder, process.kill(pid, 0), the WebSocket call. */
  note?(dataDir: string): RuntimeNote | undefined;
  alive?(pid: number): boolean;
  call?(note: RuntimeNote, method: string, params: unknown): Promise<unknown>;
}

/** Prints a new pairing link and code; 0 on success, 1 when no runtime runs there or it refused. */
export async function pairCommand(argv: readonly string[], io: PairIo): Promise<number> {
  const dataDir = flagValue(argv, 'data') ?? headlessDataDir(io);
  const note = (io.note ?? readRuntimeNote)(dataDir);
  if (!note || (note.pid !== undefined && !(io.alive ?? processAlive)(note.pid))) {
    io.error(`No running Autark found in ${dataDir}. Start it first (systemctl start autark, or autark-headless run), or pass --data <folder>.`);
    return 1;
  }
  try {
    const link = await (io.call ?? callRuntime)(note, 'pwa.link', { loopback: true }) as PairingInfo;
    const qr = io.qr ? await io.qr(link.url).catch(() => undefined) : undefined;
    for (const line of pairingLines(link, io.now(), qr)) io.print(line);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(message.split(note.token).join('[token]'));
    return 1;
  }
}
