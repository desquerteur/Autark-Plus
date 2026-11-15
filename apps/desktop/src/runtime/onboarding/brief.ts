// The Manager's first message, which its first chat receives as the Manager's own line when the first-run layer ends
// (B-090): resources/prompts/onboarding.md (or the person's own <data>/prompts/onboarding.md, context/templates.ts)
// rendered with the profile's name, company, language, the PC access choice and the one language section that fits
// the profile's language (German, French, Spanish, else English). Written by the app, so no model runs for it; the
// person's answer is the Manager's first turn.
// Owns: these values and the rendering. Never: account labels, e-mails, keys, base URLs or ids.

import type { RuntimeServices } from '../contracts.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { languageName } from '../context/prompt-stable.ts';
import { renderTemplate } from '../context/templates.ts';

/** An own prompt far too long for one chat line is cut. */
export const BRIEF_MAX = 3800;

/** The languages the shipped message is written in; any other profile language gets English. */
export const WELCOME_LANGUAGES = ['de', 'fr', 'es', 'en'] as const;

/** Used when neither an own version nor the shipped prompt can be read: the shipped English text. */
const FALLBACK = `Hi{{#name}} {{name}}{{/name}}, I'm your Manager – your right hand in Autark. Before I start, a few quick questions. Answer whatever matters to you; whatever stays open I decide myself.

1. **Language:** Which language do we speak with you – and which among ourselves in the team (notes, tasks, code)? For example everything in English, or internally English and with you in your own language.
2. **Way of working:** How should we work – how independently, how often you hear from us, what matters most to you?
3. **Setup:** {{^careful}}This PC is fully open to us. Shall I set it up completely myself right away – install what is missing, connect your apps and accounts, set everything up the way we need it?{{/careful}}{{#careful}}On this PC I work in my own area. Shall I set myself up there completely right away and connect your apps and accounts?{{/careful}}
4. **Names:** What should your team members be called – human names like Emma or Noah, or by their role, such as "Programmer"?
5. **Structure:** Do you already have ideas for how the team or your projects should be built – or shall I just start?

As soon as you answer, I work the way you say: I get to know you – what is on this PC and on the web about you, your earlier conversations with other AIs (ChatGPT, Claude and others) and what they keep about you. For each real area of your work I build a head set up like me and working beside me; I stay your direct contact, and for parallel work I split myself (Ultra). The passwords saved in your browsers I move unread into the secrets catalog, so we can fill logins everywhere. And I look at which AI models carry us better – for the work, for decisions and for search by meaning – and what you already have for them. I keep your answers as agreements for the whole team. If I should wait, just say so – I start when you are ready.`;

/** The shipped language section for a profile language ('de-AT' → 'de'; anything unknown → 'en'). */
export function welcomeLanguage(code: string | undefined): (typeof WELCOME_LANGUAGES)[number] {
  const base = (code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (WELCOME_LANGUAGES as readonly string[]).includes(base) ? base as (typeof WELCOME_LANGUAGES)[number] : 'en';
}

/** The Manager's first message for its first chat (at most BRIEF_MAX characters). */
export function setupBrief(s: RuntimeServices): string {
  let template = '';
  try { template = s.prompts?.text('onboarding') ?? ''; } catch (error) { s.log.warn('onboarding prompt unreadable', { error: String(error) }); }
  const profile = s.settings.get().profile;
  const lang = welcomeLanguage(profile.language);
  const text = renderTemplate(template.trim() || FALLBACK, {
    name: excerpt(profile.name.trim(), 80), company: excerpt(profile.company.trim(), 120), language: languageName(profile.language),
    careful: profile.pcAccess === 'careful' ? 'yes' : '',
    ...Object.fromEntries(WELCOME_LANGUAGES.map((code) => [`lang_${code}`, code === lang ? 'yes' : ''])),
  });
  return text.length > BRIEF_MAX ? `${text.slice(0, BRIEF_MAX - 1).trimEnd()}…` : text;
}
