// Electron's own entries in a company's data folder: on the desktop the data folder IS Electron's userData
// (main/app-paths.ts), and Chromium keeps these open – caches and this PC's browser state, never company data. A backup
// leaves them out (runtime/portability/backup.ts) and removing the first company keeps them where they are
// (main/company-remove.ts), because the first company's folder is the app's own.
// Owns: that list and its rule. Never: reads or touches a folder.

const ENTRIES = new Set(['blob_storage', 'Cache', 'Code Cache', 'Cookies', 'Cookies-journal', 'Crashpad', 'DawnGraphiteCache',
  'DawnWebGPUCache', 'databases', 'DevToolsActivePort', 'Dictionaries', 'DIPS', 'DIPS-journal', 'DIPS-wal', 'GPUCache', 'GPUPersistentCache',
  'GrShaderCache', 'IndexedDB', 'keyring-name', 'Local State', 'Local Storage', 'lockfile', 'Network', 'Network Persistent State', 'Partitions', 'Preferences',
  'Service Worker', 'Session Storage', 'Shared Dictionary', 'shared_proto_db', 'ShaderCache', 'SingletonCookie', 'SingletonLock',
  'SingletonSocket', 'TransportSecurity', 'Trust Tokens', 'VideoDecodeStats', 'WebStorage']);

/** One of Electron's own entries of a data folder: listed above, or one of Chromium's small databases (declarative_*.db). */
export function isElectronProfileEntry(name: string): boolean {
  return ENTRIES.has(name) || /^declarative_[\w-]*\.db(?:-journal|-wal|-shm)?$/.test(name);
}
