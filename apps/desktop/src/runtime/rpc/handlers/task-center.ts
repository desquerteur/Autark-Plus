// RPC handler: quick tasks (tasks.quickCreate, 'tasks') – runtime/tasks/quick.ts. Files are checked like a chat
// message's (chats.ts attachmentsOf: stored files only). Giving work on is tasks.give (handlers/tasks.ts).
// Owns: param checks and scope rules. Never: business logic.

import { HUMAN_ID } from '../../../shared/ids.ts';
import { QUICK_TARGET_KINDS, type QuickTaskTarget } from '../../../shared/model/task-center.ts';
import { quickCreate } from '../../tasks/quick.ts';
import { input, oneOf, onlyKeys, optId, optNum, optObj, optText, text, type Obj } from '../params.ts';
import type { HandlerTable } from '../table.ts';
import { attachmentsOf } from './chats.ts';

const TASKS = { capability: 'tasks' } as const;
const PRIORITIES = [0, 1, 2] as const;

function targetOf(o: Obj): QuickTaskTarget | undefined {
  const t = optObj(o, 'target');
  if (!t) return undefined;
  onlyKeys(t, ['kind', 'id'], 'target');
  return { kind: oneOf(t, 'kind', QUICK_TARGET_KINDS), id: text(t, 'id', { max: 120 }) };
}

export function register(table: HandlerTable): void {
  table.add('tasks.quickCreate', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['text', 'attachments', 'target', 'priority', 'spaceId', 'dueAt', 'clientId']);
    const priority = optNum(o, 'priority', { min: 0, max: 2 });
    const target = targetOf(o);
    return quickCreate(ctx.services, {
      text: optText(o, 'text', { max: 8000, multiline: true, allowEmpty: true }) ?? '', attachments: attachmentsOf(ctx.services, o.attachments),
      ...(target ? { target } : {}), priority: priority === undefined ? undefined : PRIORITIES[priority],
      spaceId: optId(o, 'spaceId'), dueAt: optNum(o, 'dueAt', { min: 0 }), clientId: optText(o, 'clientId', { max: 100 }),
    }, HUMAN_ID);
  }, TASKS);
}
