// B-084 (decision 4) the one channel between the page and the Android app: after every main-frame page load the app
// (NativePort.java) posts the string 'autark-port' with ONE MessagePort to this page's origin (WebView.postWebMessage);
// messages are JSON strings `{t: <type>, ...}` both ways. No addJavascriptInterface: an agent's sandboxed iframe can
// neither receive this port (opaque origin) nor hand the page a fake one (only a message from the top window counts).
// App → page types: companies, status, share, speechDone, saved, resume; page → app: colors, card, switch, add, forget,
// pcs, speak, stopSpeech, download, haptic. The last 'companies' and 'status' are replayed to a late subscriber, and the
// local type 'port' tells a subscriber that a (new) port arrived – right away when one is already here.
// Owns: the port, parsing and dispatch. Never: what a message means (phone-companies.ts, share.ts, … decide).

type NativeMessage = Record<string, unknown>;
type Handler = (msg: NativeMessage) => void;

let port: MessagePort | null = null;
let started = false;
const handlers = new Map<string, Set<Handler>>();
const last = new Map<string, NativeMessage>();
const REPLAYED = new Set(['companies', 'status']);

/** True once the app handed the page its port. */
export function hasNativePort(): boolean {
  return port !== null;
}

/** Sends one message to the app; false when there is no port (a browser, the iPhone web app, before the app's hello). */
export function sendNative(msg: { t: string } & Record<string, unknown>): boolean {
  if (!port) return false;
  try { port.postMessage(JSON.stringify(msg)); return true; } catch { return false; }
}

/** Calls `fn` for every app message of this type; returns the unsubscribe. */
export function onNative(type: string, fn: (msg: Record<string, unknown>) => void): () => void {
  let set = handlers.get(type);
  if (!set) { set = new Set(); handlers.set(type, set); }
  set.add(fn);
  const seen = type === 'port' ? (port ? { t: 'port' } : undefined) : last.get(type);
  if (seen) call(fn, seen);
  return () => { handlers.get(type)?.delete(fn); };
}

function call(fn: Handler, msg: NativeMessage): void {
  try { fn(msg); } catch (error) { console.error('[native-port] handler failed', error); }
}

function deliver(msg: NativeMessage): void {
  const type = msg.t;
  if (typeof type !== 'string' || !type || type === 'port') return; // 'port' is only ever local
  if (REPLAYED.has(type)) last.set(type, msg);
  for (const fn of [...(handlers.get(type) ?? [])]) call(fn, msg);
}

/** One app message (a JSON string; an object is taken as it is). */
export function parseNative(data: unknown): NativeMessage | null {
  let value: unknown = data;
  if (typeof data === 'string') { try { value = JSON.parse(data); } catch { return null; } }
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as NativeMessage).t === 'string' ? value as NativeMessage : null;
}

/** Keeps the newest port (a reload or a new page load hands a new one; the old one is closed). */
export function adoptPort(next: MessagePort): void {
  if (port === next) return;
  port?.close();
  port = next;
  next.onmessage = (event: MessageEvent) => { if (port === next) { const msg = parseNative(event.data); if (msg) deliver(msg); } };
  for (const fn of [...(handlers.get('port') ?? [])]) call(fn, { t: 'port' });
}

/** Whether a window message is the app's hello: exactly 'autark-port' with a port, not from a frame inside the page. */
export function isPortHello(event: Pick<MessageEvent, 'data' | 'ports' | 'source'>, top: unknown): boolean {
  if (event.data !== 'autark-port' || !event.ports?.[0]) return false;
  return event.source === null || event.source === top; // postWebMessage has no source window; an iframe always has one
}

/** Listens for the app's hello (once; main.tsx). A page framed by another site never takes a port: the app's page is
 *  always the top window, and a framing site must not pose as the app (it would get downloads and spoken text). */
export function startNativePort(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (window.top !== window) return;
  window.addEventListener('message', (event) => { if (isPortHello(event, window)) adoptPort(event.ports[0]!); });
}

/** Tests only: forget the port, the handlers and the replayed messages. */
export function resetNativePort(): void {
  port?.close();
  port = null;
  handlers.clear();
  last.clear();
}
