// Owns: typed handoff metadata and RPC commands. Never: imports runtime code or carries token values.
// Owner-local Claude company handoff wire contract. No secrets and no arbitrary home input.
import type { Account } from './providers.ts';
export interface RuntimeIdentity { protocol: number; company: string; data: string; accounts: string; pid: number; boot: string }
export interface Binding { company: string; account: string }
export type Phase = 'fenced' | 'sourceDisabled' | 'targetPending' | 'committed' | 'active' | 'rollbackDrain' | 'rollbackDetached' | 'rolledBack';
export interface Handoff {
  id: string; generation: number; source: Binding; target: Binding; sourceRuntime: RuntimeIdentity; targetRuntime: RuntimeIdentity;
  phase: Phase; targetHomeIntent?: string; targetHomeNonce?: string; targetHome?: string; targetIdentity?: string; previousEnabled: boolean; snapshot: Account;
}
export type TransferCommand =
  | { action: 'hello'; nonce: string }
  | { action: 'confirm'; nonce: string; source: RuntimeIdentity; challenge: string }
  | { action: 'prepare'; accountId: string; targetCompany: string; transferId: string }
  | { action: 'status' | 'advance' | 'rollback'; transferId: string }
  | { action: 'register' | 'activate' | 'detach'; transferId: string; operation: string };
export type TransferResult = Hello | Handoff | { ok: true } | { transfer: Handoff; busy: number };
export interface Hello { runtime: RuntimeIdentity; echo: string; nonce: string }
