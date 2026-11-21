// The phone/browser's device token for lib/rpc.ts's Hello (split out of rpc.ts): `#token=` in the URL wins (then it is
// stored in localStorage 'wf.token' and removed from the address), else the stored one.
// Owns: reading and keeping the token. Never: shows it or sends it anywhere but the Hello.

const TOKEN_KEY = 'wf.token';

/** Reads the device token: `#token=` in the URL wins (then stored and removed), else storage. */
export function readToken(): string {
  const match = /(?:^#|&)token=([^&]+)/.exec(location.hash);
  if (match) {
    const token = decodeURIComponent(match[1]);
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage may be blocked */ }
    history.replaceState(null, '', location.pathname + location.search);
    return token;
  }
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
