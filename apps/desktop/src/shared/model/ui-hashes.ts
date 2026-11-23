// F29 (16.11.2026): the iPhone web app's shell comes from the website, its interface from the person's PC. So that whoever
// controls the website's delivery or the phone's cache cannot slip other code into that interface, the PC names the
// SHA-256 of every file of its UI folder at UI_HASHES_PATH (runtime/http/static.ts), the shell fetches that list over the
// pinned, encrypted channel to the PC (ui/hosted/shell.ts), and the iPhone's service worker hands the page a UI file only
// with exactly those bytes (ui/hosted/ui-hashes.ts). The list comes from the PC, so a PC update brings its own list.
// Owns: the path and the list's shape. Never: hashes anything itself.

export const UI_HASHES_PATH = '/ui-hashes.json';

/** What the PC answers there: path below its UI folder ('main.js', 'chunks/app-ABCD1234.js') → SHA-256 in lower-case hex. */
export interface UiHashes { files: Record<string, string> }

/** The list as a map; rows that are no relative path with a 64-digit hex hash are left out; undefined without any row. */
export function uiHashesOf(value: unknown): Map<string, string> | undefined {
  const files = (value as Partial<UiHashes> | null)?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return undefined;
  const map = new Map<string, string>();
  for (const [file, hash] of Object.entries(files)) {
    if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) && file && !file.startsWith('/') && !file.includes('\\')) map.set(file, hash);
  }
  return map.size ? map : undefined;
}
