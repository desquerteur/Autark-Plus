// Concrete skill copies for the owner's settings editor, without general file access.
// Owns: editor document and named RPC contracts. Never: resolves caller-supplied paths.
import type { SkillInfo } from '../model/knowledge.ts';

// Safety boundary for the NEW Settings editor only; no unsafe fallback.
// Re-enable only with a proved metadata-preserving writer and runtime/package support.
export const SKILL_EDITOR_WRITE_UNAVAILABLE = 'Read-only: safe saving is unavailable. Nothing saved; keep your draft.';

export interface SkillDocument {
  info: SkillInfo;
  body: string;
  revision: string;
  readOnly: boolean;
  readOnlyReason?: string;
}

declare module './methods.ts' {
  interface Methods {
    'skills.catalog': { params: void; result: SkillInfo[] };
    'skills.open': { params: { id: string }; result: SkillDocument };
    'skills.edit': { params: { id: string; revision: string; body: string }; result: SkillDocument };
    'skills.create': { params: { name: string; description: string }; result: SkillDocument };
  }
}
