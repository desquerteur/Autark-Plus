// An error nobody caught in the main process goes to main.log, never into a dialog. Electron shows its own "A JavaScript
// error occurred in the main process" dialog for an uncaught exception unless the app has a listener of its own; feedback
// 17.11.2026 (Nora): a window closed while a frame waited for its timer, "Object has been destroyed" came out of that
// timer and the dialog stayed in front of the shared screen, blocking every agent's keystrokes until someone pressed OK.
// The process goes on as it did after that dialog (it never exited); only the dialog is gone, and the line says what
// happened: the error's name and message and where it came from (file:line:column, no folders), cut short, long
// token-like runs masked. The same line is logged once a minute with a count instead of every time (a timer that throws
// every 100 ms must not fill the log).
// Owns: the two listeners, the line and its repeat limit. Never: ends the process, shows anything, or logs a stack's
// folders or an error's attached data.

/** What `process` offers the guard (a test passes its own emitter). */
export interface ErrorSource {
  on(event: 'uncaughtException', listener: (error: unknown, origin?: string) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/** The same error is logged at most once per this many ms (with how often it came meanwhile). */
export const REPEAT_MS = 60_000;
/** How many different errors the repeat limit keeps track of. */
const KEYS_MAX = 50;
const MESSAGE_MAX = 160;

/** A stack's first frame as "file:line:col" – the folders of the install and of the person's PC stay out of the log. */
function whereOf(error: unknown): string {
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
  for (const line of stack.split('\n').slice(1)) {
    const match = /([^\\/()\s]+:\d+:\d+)\)?\s*$/.exec(line);
    if (match) return match[1]!;
  }
  return '';
}

/** One short line for an error of any kind (a thrown string or object included). */
export function describeError(error: unknown, origin: string): string {
  const name = error instanceof Error ? error.name : typeof error;
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.replace(/\s+/g, ' ').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '…').slice(0, MESSAGE_MAX);
  const where = whereOf(error);
  return `${origin}: ${name}${message ? `: ${message}` : ''}${where ? ` (${where})` : ''}`;
}

/** Registers the two listeners; `log` is main.log's line writer, `now` the clock (a test's own). */
export function guardMainErrors(source: ErrorSource, log: (line: string) => void, now: () => number = Date.now): void {
  const seen = new Map<string, { at: number; held: number }>();
  const report = (error: unknown, origin: string): void => {
    try {
      const line = describeError(error, origin);
      const known = seen.get(line);
      if (known && now() - known.at < REPEAT_MS) { known.held++; return; }
      seen.delete(line); // re-inserted last, so the oldest keys leave first
      seen.set(line, { at: now(), held: 0 });
      if (seen.size > KEYS_MAX) seen.delete(seen.keys().next().value!);
      log(`unhandled ${line}${known?.held ? ` – ${known.held} more since the last line` : ''}`);
    } catch { /* a guard that throws is the dialog again */ }
  };
  source.on('uncaughtException', (error, origin) => report(error, origin === 'unhandledRejection' ? 'rejection' : 'exception'));
  source.on('unhandledRejection', (reason) => report(reason, 'rejection'));
}
