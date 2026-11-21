// B-080 (browser-botblock E; live: 33 HTTP 403 bot checks, 3 YouTube 429s and 20 bare "fetch failed"): web.fetch reads a
// page that turned the direct fetch away as a bot again in my own browser (services.browserRead) – its head says where and
// why; a check my browser meets too is a failed fetch with no added line; while the person has my browser it answers that
// with the direct fetch's status; a runtime without a browser keeps the direct answer; a failed fetch names its cause; the
// request headers stay as they were. Live 08.11.: LinkedIn's HTTP 999 without a body counts as a bot check too.
// Owns: these assertions only. Never: network or a real browser (a scripted fetch and a fake read).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botCheck, fetchErrorText, webTools, type FetchFn } from '../../../src/runtime/tools/builtin/web.ts';
import type { BrowserRead } from '../../../src/runtime/browser/read-page.ts';
import type { ToolContext, ToolDef, ToolOutput } from '../../../src/runtime/tools/types.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';

const CHECK = '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing example.com</body></html>';

function rig(answer: { status: number; body: string; headers?: Record<string, string> } | Error, read?: BrowserRead) {
  const sent: Array<Record<string, string>> = [];
  const fetch: FetchFn = async (_url, init) => {
    sent.push(init.headers);
    if (answer instanceof Error) throw answer;
    const headers = { 'content-type': 'text/html', ...(answer.headers ?? {}) };
    // Response takes 200–599 only; fetch itself hands on any status a server sends (LinkedIn: 999, no body).
    if (answer.status > 599) return { status: answer.status, ok: false, headers: new Headers(headers), body: null } as unknown as Response;
    return new Response(answer.body, { status: answer.status, headers });
  };
  const tool = webTools({ fetch }).find((item) => item.name === 'web.fetch') as ToolDef;
  const reads: Array<{ agentId: string; url: string; use?: unknown }> = [];
  const services = { secrets: { redact: (value: string) => value, list: () => [] }, ...(read ? { browserRead: (async (agentId, url, options) => { reads.push({ agentId, url, use: options?.use }); return read(agentId, url, options); }) as BrowserRead } : {}) };
  const ctx = { agent: { id: 'ag_lena' }, conversationId: 'ch_1', taskId: 'task_1', signal: new AbortController().signal, services } as unknown as ToolContext;
  const run = (url = 'https://www.example.com/news') => tool.run({ url }, ctx) as Promise<ToolOutput>;
  return { run, sent, reads };
}

const text = (output: ToolOutput) => output.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
const page = (patch: Partial<Awaited<ReturnType<BrowserRead>>> = {}) => async () => ({ text: 'Startups raised 4 billion this week.', truncated: false, url: 'https://www.example.com/news', title: 'News', humanCheck: false, ...patch });

test('the bot-check answers: 403/429/503 with cf-mitigated or a check page\'s words, and 999; a plain 403, a 404 or a 200 is none', () => {
  const none = new Headers();
  assert.equal(botCheck(403, none, CHECK), true);
  assert.equal(botCheck(429, none, 'Our systems have detected unusual traffic from your computer network.'), true);
  assert.equal(botCheck(503, new Headers({ 'cf-mitigated': 'challenge' }), ''), true);
  assert.equal(botCheck(403, none, '<h1>403 ERROR</h1> The request could not be satisfied.'), true, 'CloudFront');
  assert.equal(botCheck(403, none, 'You are not allowed to see this folder.'), false);
  assert.equal(botCheck(200, none, CHECK), false);
  assert.equal(botCheck(999, none, ''), true, "LinkedIn's answer to an automated request, without a body");
  assert.equal(botCheck(404, none, CHECK), false, 'a plain 404 with check words');
});

test("LinkedIn's HTTP 999 with an empty body is read in my own browser; the head names it a bot check", async () => {
  const h = rig({ status: 999, body: '' }, page({ text: 'Join LinkedIn', url: 'https://ae.linkedin.com/in/someone', title: 'LinkedIn' }));
  const out = await h.run('https://ae.linkedin.com/in/someone');
  assert.equal(out.isError, false);
  assert.equal(text(out), '[untrusted web content from ae.linkedin.com, read in my own browser – the direct fetch got HTTP 999, a bot check]\nJoin LinkedIn');
  assert.deepEqual(h.reads.map((read) => read.url), ['https://ae.linkedin.com/in/someone']);
});

test('a 403 bot check is read in my own browser: the head says where and why, the person\'s request headers stay', async () => {
  const h = rig({ status: 403, body: CHECK }, page());
  const out = await h.run();
  assert.equal(out.isError, false);
  assert.equal(text(out), '[untrusted web content from www.example.com, read in my own browser – the direct fetch got HTTP 403, a bot check]\nStartups raised 4 billion this week.');
  assert.deepEqual(h.reads, [{ agentId: 'ag_lena', url: 'https://www.example.com/news', use: { conversationId: 'ch_1', taskId: 'task_1' } }]);
  assert.equal(h.sent[0]['user-agent'], 'Mozilla/5.0 (Autark agent)', 'nothing hides that I am automated');
});

test('my browser meets the check too: the page as it is, marked a failed fetch, with no line on what to do (owner 08.11.: that loops)', async () => {
  const h = rig({ status: 503, body: '', headers: { 'cf-mitigated': 'challenge' } }, page({ text: 'Just a moment...', humanCheck: true }));
  const out = await h.run();
  assert.equal(out.isError, true); // a human check has no readable page: the fetch failed
  assert.match(text(out), /^\[untrusted web content from www\.example\.com, read in my own browser – the direct fetch got HTTP 503, a bot check\]\nJust a moment\.\.\./);
  assert.doesNotMatch(text(out), /where: 'chrome'|turned my browser away|I name it to them|hand (?:it )?off/i);
});

test('while the person has my browser: the direct answer with its status, and that they have it', async () => {
  const h = rig({ status: 429, body: 'unusual traffic' }, async () => { throw new WorkforceError('conflict', 'The person has taken over my browser. I do other work meanwhile; I am woken when they hand it back.', { details: { takeover: true } }); });
  const out = await h.run();
  assert.equal(out.isError, true);
  assert.match(text(out), /HTTP 429/);
  assert.match(text(out), /It was a bot check\. The person has taken over my browser\./);
});

test('a connection reset is read in my own browser too; without a browser the direct answer stays', async () => {
  const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: 'read ECONNRESET' } });
  const h = rig(reset, page());
  assert.match(text(await h.run()), /read in my own browser – the direct fetch's connection was reset\]/);

  const plain = rig({ status: 403, body: CHECK });
  const out = await plain.run();
  assert.equal(out.isError, true);
  assert.match(text(out), /^\[untrusted web content from www\.example\.com, HTTP 403\]/, 'no browser: the direct answer');
});

test('a failed fetch names its cause', async () => {
  const notFound = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND todocast.de' } });
  assert.equal(fetchErrorText(notFound), 'getaddrinfo ENOTFOUND todocast.de');
  assert.equal(fetchErrorText(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 'ENOTFOUND');
  assert.equal(fetchErrorText(new Error('Bad port')), 'Bad port');
  const h = rig(notFound, page());
  const out = await h.run('https://todocast.de/');
  assert.equal(text(out), 'Fetch failed: getaddrinfo ENOTFOUND todocast.de');
  assert.deepEqual(h.reads, [], 'a name that does not resolve is no bot check');
});
