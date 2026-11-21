// Autark-Plus: the main-process pieces this fork adds to desktop.ts, kept here so desktop.ts stays upstream's shape
// (and under its line limit): AF-014 the Explorer's "Create Autark agent from this folder" entry and AF-019 the update
// source (Settings › Updates, update-source.json).
// Owns: building those deps once per start. Never: windows, IPC or the updater itself (updates-wiring.ts).

import { app } from 'electron';
import { ensureExplorerMenu, explorerMenuAction, type MenuDeps } from './explorer-menu.ts';
import { runCommand } from './launcher-tasks.ts';
import { loadUpdateSource, saveUpdateSource } from './updates/source-store.ts';

/** ownEntry: this start sets up this user's Explorer entry (the first company outside a test profile; once, in the background). */
export async function plusDesktop(dataDir: string, ownEntry: boolean) {
  // AF-014: the Explorer entry starts this executable (unpackaged: Electron plus the app folder) with the folder.
  const explorer: MenuDeps = { platform: process.platform, exe: process.execPath, prefix: app.isPackaged ? [] : [app.getAppPath()], run: runCommand, dir: app.getPath('userData') };
  if (ownEntry) void ensureExplorerMenu({ ...explorer, packaged: app.isPackaged });
  return {
    source: await loadUpdateSource(dataDir),
    saveSource: (source: Parameters<typeof saveUpdateSource>[1]) => saveUpdateSource(dataDir, source),
    explorerMenu: (action: unknown) => explorerMenuAction(action, explorer),
  };
}
