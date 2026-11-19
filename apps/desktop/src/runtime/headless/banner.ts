// AF-025: what a headless runtime prints for the person at its start and for `pair`: where the web access answers,
// the one-time pairing link with its 6-digit code (and a QR code on a terminal), and how to get a new code.
// The link and code pair once and end after 10 minutes (pwa/service.ts link); the owner token is never printed –
// it stays in <data>/runtime.json (0600), so a service's journal holds nothing that outlives those 10 minutes.
// Owns: the text of these lines. Never: reads state, prints, or formats a token.

export interface PairingInfo {
  url: string;
  code: string;
  expiresAt: number;
}

export interface StartInfo {
  version: string;
  dataDir: string;
  /** The web access addresses (pwa urls: https first, then localhost, LAN, tailnet). */
  urls: readonly string[];
  /** Paired phones and browsers. */
  devices: number;
  remoteId?: string;
  pairing?: PairingInfo;
  /** Why no pairing link could be made (e.g. only this PC's loopback answers). */
  pairingError?: string;
  /** The command that prints a new code (`autark-headless pair`). */
  pairCommand: string;
}

/** "123456" → "123 456". */
export function spacedCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** "482913071" → "482 913 071". */
function spacedRemoteId(id: string): string {
  return /^\d{9}$/.test(id) ? `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}` : id;
}

/** Whole minutes until `expiresAt` (at least 1 while it is still valid). */
function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(1, Math.round((expiresAt - now) / 60_000));
}

/** The pairing block: link, code, expiry and (on a terminal) the QR code. */
export function pairingLines(pairing: PairingInfo, now: number, qr?: string): string[] {
  const lines = [
    'Pair a phone or browser (works once, for ' + minutesLeft(pairing.expiresAt, now) + ' minutes):',
    `  Link:  ${pairing.url}`,
    `  Code:  ${spacedCode(pairing.code)}   (type it into the installed Autark app on the phone)`,
  ];
  if (pairing.url.startsWith('http://localhost:')) lines.push('  Only a browser on this computer can open this link (web access is bound to this computer).');
  if (qr) lines.push('', ...qr.replace(/\n+$/, '').split('\n'));
  return lines;
}

/** The start banner of a headless runtime. */
export function startLines(info: StartInfo, now: number, qr?: string): string[] {
  const rule = '-'.repeat(64);
  const lines = [rule, `Autark ${info.version} is running headless (no window).`, `  Data:  ${info.dataDir}`];
  if (info.urls.length) lines.push(`  Web:   ${info.urls.join('  ')}`);
  if (info.remoteId) lines.push(`  Remote ID:  ${spacedRemoteId(info.remoteId)}`);
  lines.push('');
  if (info.pairing) {
    lines.push(...pairingLines(info.pairing, now, qr));
  } else if (info.pairingError) {
    lines.push(`No pairing link yet: ${info.pairingError}`, 'Start with --bind lan (same network) or --bind tailscale, or pair a browser on this computer.');
  } else {
    lines.push(`${info.devices} phone${info.devices === 1 ? '' : 's'}/browser${info.devices === 1 ? '' : 's'} already paired.`);
  }
  lines.push(`New pairing code at any time:  ${info.pairCommand}`, rule);
  return lines;
}
