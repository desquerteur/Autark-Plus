// LIVE (opt-in, 17.11.2026, task_d4pdwppg "Videos im Chat flüssig"): the real video preview maker in Electron. Bundles fixtures/media-preview-main.ts
// (minified like the app's main bundle) and the preview page (src/ui/preview/page.ts with mediabunny, as scripts/build.mjs builds it) into a temp
// folder and starts Electron with them and a temp profile: a heavy portrait video (a recorded 1080×1920 WebM of noise, or the file named by
// WF_LIVE_VIDEO – e.g. a real export) goes into the blob folder, the maker converts it in its hidden sandboxed window to a light H.264/MP4 copy, and
// after the idle time that window is destroyed. No visible window, no mouse or keyboard input, no network, nothing outside the temp folder.
//   WORKFORCE_LIVE=1 node --test test/live/media-preview.test.ts
//   WORKFORCE_LIVE=1 WF_LIVE_VIDEO=<file.mp4> node --test test/live/media-preview.test.ts   (a real export: sizes and times are reported)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');

interface Report {
  error?: string; sourceBytes: number; jobMs: number; fileBytes: number; boxes: string[];
  result: { file: string; size: number; width: number; height: number; durationMs: number; mime: string };
  playable: { width: number; height: number; duration: number; played: boolean };
  openAfterJob: boolean; windowOpen: boolean; previewWindows: number; destroyed: boolean[]; windowsLeft: number;
}

test('video preview: a heavy portrait video becomes a light H.264/MP4 copy with its index in front, then the hidden window is destroyed', {
  skip: process.env.WORKFORCE_LIVE === '1' ? false : 'starts Electron: set WORKFORCE_LIVE=1', timeout: 600_000,
}, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wf-media-preview-'));
  const main = path.join(dir, 'main.cjs');
  const page = path.join(dir, 'media-preview-page.js');
  await build({
    entryPoints: [path.join(here, 'fixtures', 'media-preview-main.ts')], outfile: main, bundle: true, minify: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], logLevel: 'warning',
  });
  await build({ entryPoints: [path.join(root, 'src', 'ui', 'preview', 'page.ts')], outfile: page, bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'chrome140', logLevel: 'warning' });
  const env: NodeJS.ProcessEnv = { ...process.env, WF_LIVE_DIR: dir, WF_PREVIEW_PAGE: page, ELECTRON_ENABLE_LOGGING: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [main], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  if (process.env.WF_LIVE_TRACE) process.stdout.write(`TRACE\n${stderr}\n`);
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('RESULT '));
  assert.ok(line, `no result (exit ${code}): ${stderr.slice(-2000)}`);
  const report = JSON.parse(line.slice('RESULT '.length)) as Report;
  assert.equal(report.error, undefined, report.error);
  assert.equal(code, 0);
  const { result } = report;
  t.diagnostic(`source ${report.sourceBytes} B → copy ${report.fileBytes} B (${result.width}×${result.height}, ${result.durationMs} ms, ${result.mime}) in ${report.jobMs} ms; plays ${report.playable.width}×${report.playable.height}`);

  // A light H.264 copy: the short edge within 720 px, the aspect kept (portrait stays portrait), the index before the picture data.
  assert.equal(result.mime, 'video/mp4');
  assert.equal(report.fileBytes, result.size);
  assert.ok(Math.min(result.width, result.height) <= 720, `short edge ${Math.min(result.width, result.height)} px`);
  assert.ok(result.height > result.width, 'portrait stays portrait');
  assert.deepEqual(report.boxes.slice(0, 2), ['ftyp', 'moov'], 'the index (moov) stands in front');
  assert.ok(report.boxes.includes('mdat'));
  if (process.env.WF_LIVE_VIDEO) { // a real export: it is lighter, and as long as the original (14.5 s for the drone test video)
    assert.ok(report.fileBytes < report.sourceBytes / 2, `lighter than the original: ${report.fileBytes} of ${report.sourceBytes} B`);
    assert.ok(result.durationMs > 1000, `duration ${result.durationMs} ms`);
  }
  assert.ok(result.durationMs > 0, `duration ${result.durationMs} ms`);
  // It plays in a <video>, with its own picture size and length.
  assert.deepEqual([report.playable.width, report.playable.height], [result.width, result.height]);
  assert.ok(Math.abs(report.playable.duration * 1000 - result.durationMs) < 600, `length ${report.playable.duration} s`);
  if (process.env.WF_LIVE_VIDEO) assert.equal(report.playable.played, true, 'plays on');
  // The window stayed for a following job, then went after the idle time.
  assert.equal(report.previewWindows, 1);
  assert.equal(report.openAfterJob, true);
  assert.equal(report.windowOpen, false);
  assert.deepEqual(report.destroyed, [true], 'the hidden window is destroyed');
  assert.equal(report.windowsLeft, 0, 'no other window is left');
});
