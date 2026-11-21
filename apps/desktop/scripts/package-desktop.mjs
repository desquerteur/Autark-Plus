// Owns: the normal packaging CLI plus static NSIS extraction for local Windows builds.
// AF-003: a loud warning when the package will not be able to send feedback (no resources/feedback/receiver.json –
// `wf feedback setup` writes it); the 0.3.3 release shipped without one, so every report stayed on the sender's PC.
// Never: disables security checks, bypasses a failed CRC, or changes the installed app/profile.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enableStaticUninstaller } from './nsis-build.mjs';

const receiver = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'feedback', 'receiver.json');
if (!existsSync(receiver)) {
  console.warn([
    '',
    'WARNING: resources/feedback/receiver.json is missing – this package cannot send feedback.',
    '         Reports will only be saved on the user\'s PC ("Sending is not set up in this version").',
    '         Run `wf feedback setup --project <id> --api-key <key> --service-account <file.json>` on the team PC first.',
    '',
  ].join('\n'));
}

if (process.platform === 'win32') enableStaticUninstaller(createRequire(import.meta.url));
if (process.env.AUTARK_WINDOWS_SIGNING) {
  // 'azure': Artifact Signing on the CI runner. 'certum' (16.11.2026): a certificate in this PC's store (windows-signing-config.cjs).
  if (!['azure', 'certum'].includes(process.env.AUTARK_WINDOWS_SIGNING) || process.platform !== 'win32') throw new Error('Expected a Windows signing runner: AUTARK_WINDOWS_SIGNING is azure or certum.');
  if (process.argv.some(arg => arg === '-c' || arg.startsWith('--config') || arg.startsWith('-c.'))) throw new Error('Signed builds use the reviewed Windows signing configuration.');
  process.argv.push('--config', fileURLToPath(new URL('./windows-signing-config.cjs', import.meta.url)));
  const require = createRequire(import.meta.url);
  const config = require('./windows-signing-config.cjs');
  const { prepareNsisTools } = await import('./windows-nsis-tools.mjs');
  await prepareNsisTools({ config, projectDir: fileURLToPath(new URL('../', import.meta.url)) });
}
await import('electron-builder/cli.js');
