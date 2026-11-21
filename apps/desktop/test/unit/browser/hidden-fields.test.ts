// Card and password fields in the browser snapshot (BEFUND-RUNTIME-JAN §6, 17.11.2026): a card number typed into a Stripe
// iframe showed in clear text in browser.snapshot/batch (2 journal entries, Nora 16.11. 21:05, Vera 17.11. 17:07) – only
// type=password fields of the main document were masked. The page's own expression runs here against a small fake DOM
// (vm), one frame per document, so the real selection rule is what is tested.
// Owns: these assertions only. Never: a real browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hiddenValues, maskPasswords, PASSWORD_MASK, type PageLike } from '../../../src/runtime/browser/page.ts';

type Field = { type?: string; name?: string; id?: string; value: string; attrs?: Record<string, string> };
const frame = (url: string, fields: Field[]) => ({
  url: () => url,
  evaluate: async (expression: string) => vm.runInNewContext(expression, {
    document: { querySelectorAll: () => fields.map((field) => ({ ...field, getAttribute: (name: string) => field.attrs?.[name] ?? null })) },
  }),
});

const SNAPSHOT = [
  '- textbox "E-Mail" [ref=e1]: hello@example.com',
  '- textbox "Passwort" [ref=e2]: Geheim-2026!',
  '- textbox "Code" [ref=e3]: 481516',
  '- iframe [ref=e4]:',
  '  - textbox "Kartennummer" [ref=f1e1]: 4242 4242 4242 4242',
  '  - textbox "MM / JJ" [ref=f1e2]: 12 / 29',
  '  - textbox "CVC" [ref=f1e3]: 123',
  '- paragraph [ref=e5]: Bestellung 4242 für hello@example.com',
].join('\n');

test('card, code and password fields are hidden in every frame; other fields and page text stay', async () => {
  const page = {
    frames: () => [
      frame('https://shop.example/checkout', [
        { type: 'email', name: 'email', value: 'hello@example.com' },
        { type: 'password', name: 'pw', value: 'Geheim-2026!' },
        { type: 'text', name: 'otp', value: '481516', attrs: { autocomplete: 'one-time-code' } },
        { type: 'hidden', name: 'csrf', value: 'abcdef' },
      ]),
      frame('https://js.stripe.com/v3/elements-inner-card-1234.html', [
        { type: 'text', name: 'cardnumber', value: '4242 4242 4242 4242' },
        { type: 'text', name: 'exp-date', value: '12 / 29' },
        { type: 'text', name: 'cvc', value: '123' },
      ]),
    ],
  } as unknown as PageLike;
  const values = await hiddenValues(page);
  assert.ok(!values.includes('hello@example.com') && !values.includes('abcdef'), values.join(' | '));
  const masked = maskPasswords(SNAPSHOT, values);
  for (const secret of ['Geheim-2026!', '481516', '4242 4242 4242 4242', '12 / 29', ': 123']) assert.ok(!masked.includes(secret), `${secret} shows:\n${masked}`);
  assert.match(masked, /textbox "E-Mail" \[ref=e1\]: hello@example\.com/);
  assert.match(masked, new RegExp(`textbox "Kartennummer" \\[ref=f1e1\\]: ${PASSWORD_MASK.replace(/[()]/g, '\\$&')}`));
  assert.match(masked, /paragraph \[ref=e5\]: Bestellung 4242 für hello@example\.com/, 'text outside fields is untouched');
});

test('a field named like a card outside a payment frame is hidden too; a page without frames() falls back to evaluate', async () => {
  const fields: Field[] = [{ type: 'tel', name: 'card_number', value: '4000056655665556' }, { type: 'text', name: 'city', value: 'Wien' }];
  const one = frame('https://shop.example/', fields);
  assert.deepEqual(await hiddenValues({ evaluate: one.evaluate } as unknown as PageLike), ['4000056655665556']);
});
