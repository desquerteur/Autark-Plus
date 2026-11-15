// browser.show: an agent shows the person a web page – it opens as a tab in this chat's area above the messages and is
// shown there at once (a closed area's cell in the app gets a dot). Without a chat it goes to the person's pane (global);
// `where` says otherwise – agent: the agent's own area on its agent page (agent:<id>, place.ts sideOn with 'own'). The tab carries the
// agent and the chat; without `newTab` it is the agent's preview tab there (main/workspace-marks.ts). It is no device
// tool (offered in every mode); it goes through main (host op sideBrowser). B-081: its texts say this chat's work goes in
// this chat's area and global is the person's own across chats.
// Owns: the tool and its where text. Never: reads the page (browser.open with where: chat or global does).

import type { ToolDef } from '../tools/types.ts';
import { text } from '../tools/types.ts';
import { defineTool } from '../tools/builtin/util.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { browserUrl } from '../../shared/api/workspace-browser.ts';
import { sideCall } from './side.ts';
import { sideOn, type Place } from './place.ts';

export const BROWSER_SHOW_TOOL = 'browser.show';

const SHOW_NO_CHAT = "This run has no chat, so there is no chat area: where: 'global' is the person's pane, 'agent' my area on my agent page.";

/** Where the result says the page went. */
const PLACE_NAME: Record<Place, string> = { chat: "this chat's area", global: "the person's pane", own: 'my area on my agent page' };

/** The address as the person's browser opens it; a bad one fails with the reason. */
export function showUrl(input: string): string {
  try { return new URL(browserUrl(input)).href; } catch (error) {
    throw new WorkforceError('bad_request', error instanceof Error ? error.message : 'Use an HTTP or HTTPS address.', { details: { param: 'url' } });
  }
}

const show = defineTool<{ url: string; where?: 'chat' | 'global' | 'agent'; newTab?: boolean }>({
  name: BROWSER_SHOW_TOOL,
  description: "Shows the person a web page as a tab above this chat, with their logins. This chat's work goes there so everyone here finds it; to read or work in the page myself I use browser.open.",
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', minLength: 1, maxLength: 4000 },
      where: { type: 'string', enum: ['chat', 'global', 'agent'], description: "chat (default), global: the person's pane across chats, or agent: my area on my agent page." },
      newTab: { type: 'boolean', description: 'Else my preview tab, which my next page replaces until the person uses it.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  category: 'read',
  describe: (args) => ({ summary: `Show ${String(args.url).slice(0, 200)} in the person's browser`, reversible: true, external: false }),
  async run(args, ctx) {
    const url = showUrl(args.url);
    if (args.where === 'chat' && !ctx.conversationId) throw new WorkforceError('bad_request', SHOW_NO_CHAT);
    const place: Place = args.where === 'agent' ? 'own' : args.where ?? (ctx.conversationId ? 'chat' : 'global');
    const result = await sideCall(ctx, { action: 'open', url, ...(args.newTab === undefined ? {} : { newTab: args.newTab }), show: true, ...sideOn(ctx, place, {}) });
    return { ...text(`Opened ${url} in ${PLACE_NAME[place]} (tab ${result.tab ?? ''}).`), structured: { url, tab: result.tab } };
  },
});

export const browserShowTools: ToolDef[] = [show];
