// A page that shows a human check (reCAPTCHA, hCaptcha, Cloudflare Turnstile or its "Just a moment…" interstitial,
// "Verify you are human") sets a plain fact on the page state (service.ts PageState.humanCheck, the person's side
// browser SideBrowserResult.humanCheck) so web.fetch reports it got no readable page. Nothing is refused, and nothing
// is said to the agent about what to do with it: a human check is the person's own click, and models already defer
// there on their own – a line telling them to hand it off only makes them loop (owner 08.11.2026). The person sees the
// check on the tab (their side browser is live on every one of their devices) and clicks it there.
// B-080 (live 07.11.: Cloudflare's German "Nur einen Moment…" and "Sicherheitsüberprüfung wird durchgeführt" went
// unnoticed in ~70 results): the German words count, and so does Cloudflare's own `cf-mitigated: challenge` answer header
// in any language.
// Owns: the detection patterns. Never: tells the agent to solve, click or hand off a check.

// Only what the page shows counts – the accessibility snapshot holds visible content only, so an invisible
// reCAPTCHA v3 badge or a hidden widget frame is no check, and neither is a footer "protected by reCAPTCHA".
/** A check control: the named frame, checkbox or button of a check widget. */
const CHECK_CONTROL = /recaptcha|hcaptcha|cloudflare security challenge|i(?:'|’)?m not a robot|i am not a robot|verify (?:that )?you(?: are|'re) (?:a )?human|press (?:&|and) hold/i;
/** The words of a check page. */
const CHECK_TEXT = /verify (?:that )?you(?: are|'re) (?:a )?human|i(?:'|’)?m not a robot|are you a robot\?|checking (?:if the site connection is secure|your browser before accessing)|ich bin kein roboter|bestätigen sie, dass sie ein mensch sind|sicherheitsüberprüfung wird durchgeführt|dass sie kein bot sind|problem with verification/i;
/** Challenge pages by address. */
const CHECK_URL = /challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform\/|captcha-delivery\.com/i;
const CHECK_TITLE = /^(?:just a moment\.*|attention required!? \| cloudflare|verify you are human|ein moment bitte|nur einen moment)/i;

/** Does this page ask for a human check? */
export function isHumanCheck(page: { snapshot: string; url: string; title: string }): boolean {
  if (CHECK_TITLE.test(page.title.trim()) || CHECK_URL.test(page.url)) return true;
  return page.snapshot.split('\n').some((line) => {
    const element = /^\s*- (\w+)/.exec(line)?.[1];
    if (element === 'iframe' || element === 'checkbox' || element === 'button') return CHECK_CONTROL.test(line);
    return (element === 'heading' || element === 'text' || element === 'paragraph' || element === 'generic') && CHECK_TEXT.test(line);
  });
}

/** Is this navigation answer Cloudflare's challenge (`cf-mitigated: challenge`)? A Playwright Response, or nothing. */
export function isChallengeAnswer(response: unknown): boolean {
  const headers = (response as { headers?: unknown } | null | undefined)?.headers;
  if (typeof headers !== 'function') return false;
  try {
    const value = (headers.call(response) as Record<string, unknown> | undefined)?.['cf-mitigated'];
    return typeof value === 'string' && /challenge/i.test(value);
  } catch {
    return false;
  }
}
