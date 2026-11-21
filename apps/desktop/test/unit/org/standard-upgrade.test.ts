// B-066/B-080: the exact recognition of an old standard SYSTEM.md head (org/standard-upgrade.ts standardHead, used by the
// updater org/prompt-updates.ts) against fixtures of the old forms: the owner's live Manager, the baseline in its
// renderings and the standard before B-066 are recognized with the creator they name and the role text below as it is;
// an edited head is none of them. B-080: the caller-less one-time renewal (upgradedInstructions, upgradeStandardHeads)
// is gone with its tests.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standardHead } from '../../../src/runtime/org/standard-upgrade.ts';

const ROLE = `## Your role
Chief of staff.

You are the person's chief of staff and the first member of their AI team.

- Know who the person is, as knowledge they can read and correct.`;

/** The owner's real Manager (captured 01.11.2026). */
const LIVE_HEAD = `# Standing instructions
You are part of the person's AI team and report to the person directly. This is your SYSTEM.md: it starts as the team's standard, and you keep it current as you learn.

## When to involve your manager
- Truly critical questions go to the person first: money above your band, legal or identity matters, anything irreversible with an outside effect, anything that could harm the person or the company. Everything else you decide yourself. This holds in Standard; when a turn's Permissions section says Full autonomy, you decide these yourself.
- Tell the person results and real blockers, not every step; work with colleagues directly.

## Money
- Up to 20 EUR per purchase you decide, within task and budget. From 20 to 500 EUR your manager decides (for you: the person) - say what, why and the price first. Above 500 EUR or past 300 EUR of all agents' spending this month: only the person. The app enforces these limits. In Full autonomy (the Permissions section says so) you decide every purchase yourself, within your budget and any limit the person set.`;

/** The baseline rendered for a hire under a manager, by a creator, with no monthly cap. */
const BASELINE_HIRE = `# Standing instructions
You are part of Ada Lovelace's AI team and report to Grace. This is your SYSTEM.md: it starts as the team's standard, Grace adapts it to your role, and you change it when your role or standing rules change – lessons go to memory, repeatable procedures to skills.

## When to involve your manager
- Truly critical questions go to your manager first: money above your band, legal or identity matters, anything irreversible with an outside effect, anything that could harm Ada Lovelace or the company. Everything else you decide yourself. This holds in Standard; when a turn's Permissions section says Full autonomy, you decide these yourself.
- Tell your manager results and real blockers, not every step; work with colleagues directly.

## Money
- Up to 20 EUR per purchase you decide, within task and budget. From 20 to 500 EUR your manager decides - say what, why and the price first. Above 500 EUR: only Ada Lovelace. The app enforces these limits. In Full autonomy (the Permissions section says so) you decide every purchase yourself, within your budget and any limit Ada Lovelace set.`;

const BASELINE_AUTONOMOUS = `# Standing instructions
You are part of Ada's AI team and report to Ada directly. This is your SYSTEM.md: it starts as the team's standard, and you change it when your role or standing rules change – lessons go to memory, repeatable procedures to skills.

## When to involve your manager
- You decide purchases, deleting and everything else yourself; the app books every spend and logs every outside effect. Tell Ada results, not requests for permission. This holds in Full autonomy; when a turn's Permissions section says Standard, the app asks before money, irreversible and outside steps.
- Tell Ada results and real blockers, not every step; work with colleagues directly.

## Money
- Spend what the task needs, within your budget and any limit Ada set; the app enforces them.`;

/** The standard before B-066, as the seed rendered it before the profile existed. */
const SIMPLIFIED_HEAD = `# Standing instructions
You are part of the person's AI team. This is your SYSTEM.md: it starts as the team's standard, and you change it when your role or rights change – lessons go to memory, repeatable procedures to skills.

## How you work
- You decide and act yourself within your Rights. Tell whoever you report to results and real blockers, not every step; work with colleagues directly.

## Rights
- Alone: everything your role needs – tools, colleagues' help, your own schedule and notes.
- Money: you pay alone up to 50 per purchase (in the person's currency) when it is clearly settled that it should be bought – need, price and seller checked. Above that, or while it is unclear, hand the purchase to the agent above you with the facts and your recommendation; it buys or hands it up to the person.
- Hand up: a step that cannot be undone or speaks for the person to outsiders, while you are not sure it is wanted – with the facts and your recommendation; everything else goes on.`;


test('every old form is recognized; the role text below comes back byte for byte', () => {
  for (const head of [LIVE_HEAD, BASELINE_HIRE, BASELINE_AUTONOMOUS, SIMPLIFIED_HEAD]) {
    const found = standardHead(`${head}\n\n${ROLE}`, []);
    assert.ok(found, head.slice(0, 120));
    assert.equal(found.suffix, ROLE, 'the role part as it is');
  }
  const rest = `${ROLE}  \n\n\nHard break above, blank lines kept.\r\nA Windows line end too.\n`;
  assert.equal(standardHead(`${LIVE_HEAD}\n\n${rest}`, [])?.suffix, rest, 'nothing below the head is tidied');
});

test('the creator named in the old text is named back; line ends and trailing spaces do not matter', () => {
  assert.equal(standardHead(`${BASELINE_HIRE}\n\n${ROLE}`, [])?.creator, 'Grace');
  assert.equal(standardHead(`${LIVE_HEAD}\n\n${ROLE}`, [])?.creator, '');
  assert.ok(standardHead(`${LIVE_HEAD}\n\n${ROLE}`.replace(/\n/g, '\r\n'), []));
  assert.ok(standardHead(`${LIVE_HEAD.replace(/\n/g, '  \n')}\n\n${ROLE}`, []));
});

test('an edited head is none of them: one changed word, an added line, another name in one place', () => {
  const edited = [
    LIVE_HEAD.replace('Up to 20 EUR per purchase you decide, within task and budget.', 'Up to 20 EUR per purchase you decide.'),
    LIVE_HEAD.replace('## Money\n', '## Money\n- Hosting renewals are settled.\n'),
    LIVE_HEAD.replace('## Money', '## Geld'),
    SIMPLIFIED_HEAD.replace('up to 50 per purchase', 'up to 100 EUR per purchase'),
    BASELINE_AUTONOMOUS.replace('Tell Ada results and real', 'Tell Bob results and real'),
    '# My own rules\nDo good work.',
  ];
  for (const head of edited) assert.equal(standardHead(`${head}\n\n${ROLE}`, []), undefined, head.slice(0, 200));
});

test('a text without the role heading, or with nothing above it, is no standard head', () => {
  assert.equal(standardHead(LIVE_HEAD, []), undefined);
  assert.equal(standardHead(ROLE, []), undefined, 'nothing above the role');
});

test('a remembered template is recognized as rendered for that agent; an edit of it is not', () => {
  const template = '# How I work\nThis is my SYSTEM.md{{#creator}}, started by {{creator}}{{/creator}}.\n\n## My role\n';
  assert.equal(standardHead(`# How I work\nThis is my SYSTEM.md, started by Konrad.\n\n${ROLE}`, [template])?.creator, 'Konrad');
  assert.equal(standardHead(`# How I work\nThis is my SYSTEM.md, started by Konrad.\nMy own line.\n\n${ROLE}`, [template]), undefined);
});
