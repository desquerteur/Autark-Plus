// app.install (B-080): an agent installs an Autark build on this PC the way an update installs – the same drain, the
// relaunch helper with this installer, the new version's start – instead of ending Autark from a shell. The install is
// kept with who started it (tasks/recover-notes.ts installBuild), so the next start tells that agent whether it landed
// (ownership.recover) and the person whether the update installed (the start notice). Offered in every mode.
// Owns: the tool definition. Never: kills processes, copies program files or decides when to install.

import type { ToolDef } from '../types.ts';
import { failure, json } from '../types.ts';
import { installBuild } from '../../tasks/recover-notes.ts';
import { defineTool } from './util.ts';

export const APP_INSTALL_TOOL = 'app.install';

const appInstall = defineTool<{ installer: string }>({
  name: APP_INSTALL_TOOL,
  description: 'Installs an Autark build on this PC the way an update does. Running turns end cleanly and the new version tells me at its start whether it landed; ending Autark from a shell would cut them mid-step.',
  inputSchema: {
    type: 'object',
    properties: { installer: { type: 'string', description: 'The Setup .exe from npm run package (on Linux the AppImage).' } },
    required: ['installer'],
    additionalProperties: false,
  },
  category: 'write_system',
  describe: (args) => ({ summary: 'Install an Autark build and restart', resource: args.installer, external: false }),
  async run(args, ctx) {
    if (typeof args.installer !== 'string' || !args.installer.trim()) return failure('installer is the full path of the Setup .exe.');
    try {
      const record = await installBuild(ctx.services, args.installer.trim(), {
        agentId: ctx.agent.id, runId: ctx.runId, ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}), ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      });
      return json({ ok: true, installing: record.installer, from: record.from, ...(record.to ? { to: record.to } : {}), next: 'Autark ends this turn, installs and starts again; my next turn hears whether it landed.' });
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  },
});

export const appInstallTools: ToolDef[] = [appInstall];
