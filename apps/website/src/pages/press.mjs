// Owns: sourced coverage of OpenAutark, separate from collaborators and endorsements.
import { page, pageHero } from '../layout.mjs';

// New coverage is appended here; dates refer to the publisher's original article.
export const coverage = [{
  publisher: 'AI Business', date: '2026-11-09', displayDate: '9 November 2026',
  title: 'OpenAutark: AI agents with jobs, memory and a manager',
  url: 'https://aibusiness.vc/startups/openautark-teydra-lab-ai-agent-team-on-your-own-computer',
  summary: 'A written interview about turning individual AI chats into a continuing team on your own computer: agent roles, shared work, memory and the manager that coordinates it.',
  disclosure: 'Published as a Partner Story: a written interview with Teydra Lab, presenting the company’s own claims. The publisher states that no payment was involved. This is not an independent product review or an endorsement.',
}];

export default function press(rel) {
  return page({ slug: 'press', rel, title: 'In the press',
    description: 'Articles and interviews about OpenAutark, with original sources and publication dates.',
    body: (root) => `${pageHero({ root, crumb: 'In the press', title: 'In the <em>press.</em>', lead: 'Articles and conversations about OpenAutark. Read each story at its original source.' })}
<section class="section"><div class="wrap"><div class="prose">
${coverage.map((item) => `<article><p><strong>${item.publisher}</strong> · <time datetime="${item.date}">${item.displayDate}</time> · Written interview</p>
<h2><a href="${item.url}" rel="noopener">${item.title}</a></h2>
<p>${item.summary}</p><p>${item.disclosure}</p>
<p><a class="btn btn--ink" href="${item.url}" rel="noopener">Read on ${item.publisher} →</a></p></article>`).join('\n')}
<hr><p>Looking for product images or facts? Visit our <a href="${root}brand/">brand and press kit</a>.</p>
</div></div></section>` });
}
