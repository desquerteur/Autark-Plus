// Owner settings editor: concrete skill copies, not unrestricted host files.
// Owns: editor params and secure Settings-device scope. Never: broadens manage/delete APIs.
import '../../../shared/api/methods-skills.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { input, onlyKeys, text } from '../params.ts';
import type { HandlerTable, HandlerContext } from '../table.ts';
const SETTINGS = { capability: 'settings', secure: true } as const;
const service = (ctx: HandlerContext) => {
  const skills = ctx.services.skills;
  if (!skills.catalog || !skills.open || !skills.edit || !skills.create) throw new WorkforceError('unavailable', 'This runtime has no skill editor.');
  return skills as Required<Pick<typeof skills, 'catalog' | 'open' | 'edit' | 'create'>>;
};
const key = (o: Record<string, unknown>, name: string) => {
  const value = text(o, name, { max: 64 });
  if (!/^[a-f0-9]{64}$/.test(value)) throw new WorkforceError('bad_request', `Invalid skill ${name}.`);
  return value;
};
export function register(table: HandlerTable): void {
  table.add('skills.catalog', (params, ctx) => {
    onlyKeys(input(params ?? {}), []);
    return service(ctx).catalog();
  }, SETTINGS);
  table.add('skills.open', (params, ctx) => {
    const o = input(params); onlyKeys(o, ['id']);
    return service(ctx).open(key(o, 'id'));
  }, SETTINGS);
  table.add('skills.edit', (params, ctx) => {
    const o = input(params); onlyKeys(o, ['id', 'revision', 'body']);
    return service(ctx).edit(key(o, 'id'), key(o, 'revision'), text(o, 'body', { max: 200_000, multiline: true, allowEmpty: true }));
  }, SETTINGS);
  table.add('skills.create', (params, ctx) => {
    const o = input(params); onlyKeys(o, ['name', 'description']);
    return service(ctx).create(text(o, 'name', { max: 64 }), text(o, 'description', { max: 1024 }));
  }, SETTINGS);
}
