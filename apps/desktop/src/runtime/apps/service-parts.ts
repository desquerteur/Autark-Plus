// The Apps service's own state shapes and two small helpers, moved out of service.ts unchanged (16.11.2026: the file
// passed the 450-line limit). Owns: an item's live state, an attempt's mode, the real timers and filling secret://
// handles from the vault. Never: connects, registers tools or writes status (service.ts).

import { SYSTEM_ID } from '../../shared/ids.ts';
import type { AppStatus } from '../../shared/model/apps.ts';
import type { Timers } from '../schedules/scheduler.ts';
import type { AppsDeps } from './deps.ts';
import { ReconnectNeeded, type Connector, type McpToolDef, type OAuthStart } from './types.ts';

export interface Item {
  connector: Connector;
  status: AppStatus;
  error?: string;
  tools: McpToolDef[];
  registered: string[];
  signIn?: OAuthStart;
  /** The newest attempt: an older one's result is dropped. */
  gen: number;
  /** The refused access token was dropped once since the last success. */
  renewed?: boolean;
}

export interface AttemptMode {
  /** A 401 may open the browser sign-in. */
  signIn: boolean;
  /** Right after a completed sign-in: a 401 again ends in 'signin'. */
  afterSignIn?: boolean;
}

const HANDLE = /secret:\/\/([A-Za-z0-9_-]{1,128})/g;

export const realTimers: Timers = {
  set: (fn, ms) => { const handle = setTimeout(fn, ms); handle.unref?.(); return handle; },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `text` with every secret://<id> handle filled in from the vault (the runtime's own use). */
export async function resolveHandles(secrets: AppsDeps['services']['secrets'], text: string, host?: string): Promise<string> {
  const ids = [...new Set([...text.matchAll(HANDLE)].map((match) => match[1]))];
  if (!ids.length) return text;
  const values = new Map<string, string>();
  for (const id of ids) {
    try { values.set(id, await secrets.use(id, SYSTEM_ID, host || undefined)); } catch {
      throw new ReconnectNeeded(`secret://${id} is not in the secrets catalog – save it there first (secrets.save).`);
    }
  }
  return text.replace(HANDLE, (match, id: string) => values.get(id) ?? match);
}
