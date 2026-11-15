// Shared security rules for HTTP engines (ported from legacy connections.cjs / inference.cjs).
// Owns: endpoint validation (HTTPS or loopback HTTP, no userinfo/query/fragment), `redirect:'error'`,
// 1 MiB cap per JSON body / SSE event, fixed user-safe error messages per status, key redaction,
// and an SSE reader. B-083: a used-up prepaid credit (a plan's monthly API credits or any key's balance) is recognised
// from the first bytes of a refused 400/429 body – read only to classify – and cools the account for a day.
// Never: puts provider response bodies or keys into errors, logs or events.

import type { WorkforceErrorData } from '../../../shared/errors.ts';
import type { Account } from '../../../shared/model/providers.ts';
import { ERR } from '../shared.ts';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const MAX_JSON = 1024 * 1024;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1', // B-058: OpenAI-compatible (chat, /audio/transcriptions, /models)
  elevenlabs: 'https://api.elevenlabs.io/v1', // B-058: media only (runtime/media/providers/elevenlabs.ts)
  fal: 'https://queue.fal.run', // B-058: media only, queue API (runtime/media/providers/fal.ts)
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  llamacpp: 'http://127.0.0.1:8080/v1',
  vllm: 'http://127.0.0.1:8000/v1',
};

export const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp', 'vllm']);

/** Validates and normalizes a base URL; throws a user-safe Error. */
export function endpointFor(account: Pick<Account, 'provider' | 'baseUrl'>): string {
  const raw = account.baseUrl ?? DEFAULT_BASE[account.provider];
  if (!raw) throw new Error('This connection has no server URL.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Enter a valid server URL.'); }
  const loopback = LOOPBACK.has(url.hostname);
  const local = LOCAL_PROVIDERS.has(account.provider);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || (local && !loopback) || url.username || url.password || url.search || url.hash) {
    throw new Error(local ? 'Local connections must use a loopback address without credentials in the URL.' : 'Use an HTTPS server URL without credentials, query parameters or fragments.');
  }
  return url.href.replace(/\/+$/, '');
}

/** B-079: how long a key whose credit is used up (HTTP 402) stays out of routing before one call tries it again. */
export const CREDIT_COOLDOWN_MS = 6 * 60 * 60_000;
/** B-083: how long an account whose prepaid credit the provider calls used up waits – tried again daily, so a new billing
 *  month's plan credits are found within a day. */
export const CREDIT_EXHAUSTED_COOLDOWN_MS = 24 * 60 * 60_000;
/** B-083: the providers' error fields for it – Anthropic HTTP 400 `"message": "Your credit balance is too low …"`, OpenAI
 *  HTTP 429 `"code": "insufficient_quota" | "credit_balance_exhausted"`. Fields, not free text: a body that echoes a request
 *  or an upstream text (escaped quotes) never matches. */
const CREDIT_USED_UP = /"code"\s*:\s*"(?:insufficient_quota|credit_balance_exhausted)"|"message"\s*:\s*"Your credit balance is too low/;
/** How much of a refused request's body is read to recognise them. */
const ERROR_PEEK = 16 * 1024;

/** B-083: a used-up prepaid credit is a limit of the account – it cools a day, and routing takes another model meanwhile. */
export function creditError(): WorkforceErrorData {
  return { code: 'rate_limited', message: 'The credit of this key is used up. Another model takes over; this key is tried again in a day.', retryAfterMs: CREDIT_EXHAUSTED_COOLDOWN_MS };
}

export function statusError(status: number): WorkforceErrorData {
  if (status === 401) return { code: 'unavailable', message: 'The provider rejected this connection. Reconnect in Settings.' };
  // B-079 (live 07.11.: a gateway's free credit ran out and every decision call failed with 402 for hours, never moving
  // on): a used-up credit is a limit of the account – it cools, and routing takes another model until it is topped up.
  if (status === 402) return { code: 'rate_limited', message: 'The credit of this key is used up (HTTP 402). Another model takes over until it is topped up.', retryAfterMs: CREDIT_COOLDOWN_MS };
  // Gateways can allow some models and deny others on the same valid key (e.g. free credits).
  // A 403 establishes neither an invalid key nor an outage of the whole account.
  if (status === 403) return { code: 'forbidden', message: 'The provider denied access to this model or request (HTTP 403). Check model permissions or paid-credit requirements; this does not establish that the API key is invalid.' };
  if (status === 429) return ERR.limit();
  if (status === 400 || status === 404 || status === 422) return { code: 'bad_request', message: 'The model did not accept this request. Check the selected model.' };
  if (status === 529 || status === 503) return { code: 'unavailable', message: 'The provider is overloaded. Retry later.' };
  return { code: 'internal', message: `The model request failed (HTTP ${status}).` };
}

export function retryAfter(response: Response): number | undefined {
  const ms = response.headers.get('retry-after-ms');
  if (ms !== null && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export class HttpEngineError extends Error {
  readonly data: WorkforceErrorData;
  /** Tokens the failed request already consumed (a cut-off or refused answer is still billed). */
  readonly usage?: { inputTokens: number; outputTokens: number };
  constructor(data: WorkforceErrorData, usage?: { inputTokens: number; outputTokens: number }) { super(data.message); this.data = data; this.usage = usage; }
}

const LOST: WorkforceErrorData = { code: 'unavailable', message: 'The connection to the model was lost. Retry later.' };

/** reader.read() that turns transport failures (reset, idle timeout) into a safe "unavailable". */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  try { return await reader.read(); } catch { throw new HttpEngineError({ ...LOST }); }
}

/** POST JSON with the security rules; returns the Response (ok) or throws HttpEngineError. */
export async function postJson(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error', signal });
  } catch {
    if (signal.aborted) throw new HttpEngineError(ERR.cancelled());
    throw new HttpEngineError({ code: 'unavailable', message: 'Could not reach the model. Check the connection before retrying.' });
  }
  if (!response.ok) throw new HttpEngineError(await refusal(response));
  return response;
}

/** The safe error of a refused request: by its status, or a used-up credit its 400/429 body names (B-083). */
async function refusal(response: Response): Promise<WorkforceErrorData> {
  const peekable = response.status === 400 || response.status === 429;
  const text = peekable ? await peek(response) : '';
  if (!peekable) await response.body?.cancel().catch(() => {});
  if (CREDIT_USED_UP.test(text)) return creditError();
  const data = statusError(response.status);
  if (response.status === 429) data.retryAfterMs = retryAfter(response);
  return data;
}

/** The first ERROR_PEEK bytes of a refused request's body, only to classify it – never into an error, log or event. */
async function peek(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < ERROR_PEEK) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch { /* unreadable: the status alone decides */ } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a JSON body with a byte cap. */
export async function readJson(response: Response, max = MAX_JSON): Promise<unknown> {
  if (!response.body) throw new HttpEngineError(ERR.failed('The provider returned an empty response.'));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await readChunk(reader);
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new HttpEngineError(ERR.failed('The model response is too large.'));
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpEngineError(ERR.failed('The provider returned an invalid response.')); }
}

/**
 * Server-sent events: yields `{event, data}` with `data` parsed as JSON (or the raw string for
 * `[DONE]`). Each event is capped at 1 MiB; the whole stream at `maxTotal`.
 */
export async function* readSse(response: Response, maxTotal = 32 * MAX_JSON): AsyncGenerator<{ event?: string; data: unknown }> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  let carriage = false; // the last chunk ended in CR: it may pair with an LF at the start of the next one
  try {
    for (;;) {
      const { done, value } = await readChunk(reader);
      if (done && !carriage) break;
      let text: string = carriage ? '\r' : '';
      if (!done) {
        total += value.byteLength;
        if (total > maxTotal) throw new HttpEngineError(ERR.failed('The model response is too large.'));
        text += decoder.decode(value, { stream: true });
      }
      carriage = !done && text.endsWith('\r');
      buffer += (carriage ? text.slice(0, -1) : text).replace(/\r\n?/g, '\n'); // CRLF, CR and LF all end a line
      if (buffer.length > MAX_JSON && buffer.indexOf('\n\n') < 0) throw new HttpEngineError(ERR.failed('The model response is too large.'));
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let event: string | undefined;
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) continue;
        const payload = data.join('\n');
        if (payload === '[DONE]') { yield { event, data: payload }; continue; }
        let parsed: unknown;
        try { parsed = JSON.parse(payload); } catch { throw new HttpEngineError(ERR.failed('The provider returned an invalid response.')); }
        yield { event, data: parsed };
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
}

/** Removes an echoed key from text. */
export function redact(text: string, key: string | undefined): string {
  return key && key.length >= 8 ? text.split(key).join('[redacted]') : text;
}

/** Converts thrown errors from a turn into safe error data. */
export function turnError(error: unknown, signal: AbortSignal): { stop: 'error' | 'interrupted' | 'limit'; error: WorkforceErrorData } {
  if (signal.aborted) return { stop: 'interrupted', error: ERR.cancelled() };
  const data = error instanceof HttpEngineError ? error.data : ERR.failed();
  return { stop: data.code === 'rate_limited' ? 'limit' : data.code === 'cancelled' ? 'interrupted' : 'error', error: data };
}

export const MAX_TOOL_ITERATIONS = 40;
