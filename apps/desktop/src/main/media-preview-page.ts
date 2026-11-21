// 17.11.2026 (Konrad task_d4pdwppg): the HTML and the CSP of the video preview window's page (media-preview-routes.ts serves them as
// wf-file://media-preview/job/<n>/ and /page.js). The page script itself is src/ui/preview/page.ts, built with mediabunny into
// app/media-preview-page.js (scripts/build.mjs) – it reads the job's video from its own origin, converts it with the browser's own
// codecs (WebCodecs) and posts the copy back in pieces.
// Owns: these two strings. Never: lets the page reach anything but its own origin: no network, no frames, no inline script, workers only from its own blobs (mediabunny merges the colour and alpha of a WebM in one).

export const PREVIEW_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>preview</title></head><body><script src="/page.js"></script></body></html>';

/** Script from the session's own origin only; fetch to the job's routes only; workers only from the page's own blobs; no plugins or frames. */
export const PREVIEW_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
