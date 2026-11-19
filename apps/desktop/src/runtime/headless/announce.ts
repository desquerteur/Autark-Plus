// AF-025: what a headless runtime does for the person once it listens: the web access gets the asked reach (`--bind`;
// a fresh runtime that only this PC's loopback reaches takes the same network, as Settings › Devices does), and while
// no phone or browser is paired yet, one pairing link with its code goes to the console (banner.ts).
// Owns: that order and the choice whether to pair. Never: prints the owner token, keeps a link, or pairs anything itself
// (the person opens the link or types the code; pwa/service.ts exchanges it).

import type { Bind } from './options.ts';
import { startLines, type PairingInfo } from './banner.ts';

export interface AnnounceDeps {
  pwa: {
    state(): Promise<{ urls: string[]; devices: readonly unknown[] }>;
    enable(input: { enabled: boolean; bind?: Bind }): Promise<unknown>;
    link(input: { loopback?: boolean }): Promise<PairingInfo>;
  };
  /** The saved reach (settings pwa.bind). */
  bind(): Bind;
  remoteId?(): string | undefined;
  /** A QR code as terminal text (only asked for on a terminal). */
  qr?(text: string): Promise<string>;
  now(): number;
}

export interface AnnounceOptions {
  version: string;
  dataDir: string;
  bind?: Bind;
  pair: boolean;
  pairCommand: string;
}

/** Applies the reach, makes a pairing link when none is paired yet, and returns the banner lines. */
export async function announceStart(deps: AnnounceDeps, options: AnnounceOptions): Promise<string[]> {
  let state = await deps.pwa.state();
  if (options.bind && options.bind !== deps.bind()) {
    await deps.pwa.enable({ enabled: true, bind: options.bind });
    state = await deps.pwa.state();
  } else if (!options.bind && deps.bind() === 'localhost' && state.devices.length === 0) {
    await deps.pwa.enable({ enabled: true }); // only the loopback answers: the same network (pwa/service.ts enable)
    state = await deps.pwa.state();
  }
  let pairing: PairingInfo | undefined;
  let pairingError: string | undefined;
  if (options.pair && state.devices.length === 0) {
    try {
      pairing = await deps.pwa.link({ loopback: true });
    } catch (error) {
      pairingError = error instanceof Error ? error.message : String(error);
    }
  }
  let qr: string | undefined;
  if (pairing && deps.qr) qr = await deps.qr(pairing.url).catch(() => undefined);
  let remoteId: string | undefined;
  try { remoteId = deps.remoteId?.(); } catch { remoteId = undefined; }
  return startLines({
    version: options.version, dataDir: options.dataDir, urls: state.urls, devices: state.devices.length,
    remoteId, pairing, pairingError, pairCommand: options.pairCommand,
  }, deps.now(), qr);
}
