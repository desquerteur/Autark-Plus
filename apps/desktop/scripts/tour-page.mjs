// Feedback 16.11.2026 (F15): the Android app's feedback video as one self-contained page – the tour's phone variant
// (src/ui/tour/phone-page.tsx) and its stylesheet (src/ui/tour/phone-page.css) bundled by esbuild, as the desktop build
// does, and inlined into one tour.html with a strict content policy (no network, nothing but its own inline code).
// apps/android/build.ps1 writes it into the APK's assets (app/build.gradle: build/generated/tour), where the app shows
// it before its pairing screens (IntroTour.java).
//   node scripts/tour-page.mjs <out-file>
// Owns: that page. Never: the PC UI's build (scripts/build.mjs) or anything that reaches out of the page.

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The page's entries, relative to apps/desktop. */
export const TOUR_PAGE_ENTRIES = { script: 'src/ui/tour/phone-page.tsx', style: 'src/ui/tour/phone-page.css' };

/** The whole page as one HTML string (the code and the styles inline). */
export async function bundleTourPage({ minify = true } = {}) {
  const common = { absWorkingDir: root, bundle: true, write: false, minify, legalComments: 'none', logLevel: 'warning', target: 'chrome140' };
  const [script, style] = await Promise.all([
    build({ ...common, entryPoints: [TOUR_PAGE_ENTRIES.script], format: 'iife', platform: 'browser', jsx: 'automatic', jsxImportSource: 'preact' }),
    build({ ...common, entryPoints: [TOUR_PAGE_ENTRIES.style] }),
  ]);
  const js = script.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = style.outputFiles[0].text.replace(/<\/style/gi, '<\\/style');
  return [
    '<!doctype html>',
    '<html lang="en" data-theme="system">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">`,
    '<title>How to send feedback</title>',
    `<style>${css}</style>`,
    '</head>',
    `<body class="tour-page"><div id="tour"></div><script>${js}</script></body>`,
    '</html>',
    '',
  ].join('\n');
}

/** Writes the page to `out` (its folder is made). */
export async function writeTourPage(out, options) {
  await mkdir(path.dirname(out), { recursive: true });
  const html = await bundleTourPage(options);
  await writeFile(out, html);
  return html.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/tour-page.mjs <out-file>'); process.exit(2); }
  const size = await writeTourPage(path.resolve(out));
  console.log(`tour page: ${path.resolve(out)} (${Math.round(size / 1024)} KB)`);
}
