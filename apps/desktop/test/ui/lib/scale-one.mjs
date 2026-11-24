// Owns: one device pixel per CSS pixel for every Electron window the UI tests start (desquerteur/Autark-Plus#27).
// Loaded by `npm run test:ui` through `node --import`, before any test file: it wraps playwright-core's
// _electron.launch so each launch gets --force-device-scale-factor=1 in front of the test's own args.
// Why: on a display scaled to 125 % (lexivers: 1536x960, 120 DPI) Chromium rounds window and element sizes
// to device pixels: change-app and feedback-button both read 642 for a requested 640 px viewport.
// Both checks pass with this switch on the same build. Other UI failures need separate verification.
// Never: changes the app itself or a test's own launch options besides prepending that one switch.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { _electron: electron } = createRequire(path.join(desktop, 'package.json'))('playwright-core');
const SWITCH = '--force-device-scale-factor=1';

const launch = electron.launch.bind(electron);
electron.launch = (options = {}) => {
  const args = options.args ?? [];
  return launch({ ...options, args: args.includes(SWITCH) ? args : [SWITCH, ...args] });
};
