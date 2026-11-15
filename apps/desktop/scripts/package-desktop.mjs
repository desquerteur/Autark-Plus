// Owns: the normal packaging CLI plus static NSIS extraction for local Windows builds.
// Never: disables security checks, bypasses a failed CRC, or changes the installed app/profile.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { enableStaticUninstaller } from './nsis-build.mjs';

if (process.platform === 'win32') enableStaticUninstaller(createRequire(import.meta.url));
if (process.env.AUTARK_WINDOWS_SIGNING) {
  if (process.env.AUTARK_WINDOWS_SIGNING !== 'azure' || process.platform !== 'win32') throw new Error('Expected an Azure Windows signing runner.');
  if (process.argv.some(arg => arg === '-c' || arg.startsWith('--config') || arg.startsWith('-c.'))) throw new Error('Signed builds use the reviewed Windows signing configuration.');
  process.argv.push('--config', fileURLToPath(new URL('./windows-signing-config.cjs', import.meta.url)));
  const require = createRequire(import.meta.url);
  const config = require('./windows-signing-config.cjs');
  const { prepareNsisTools } = await import('./windows-nsis-tools.mjs');
  await prepareNsisTools({ config, projectDir: fileURLToPath(new URL('../', import.meta.url)) });
}
await import('electron-builder/cli.js');
