// The error every rpc.call rejects with, and the short text the UI shows for any error (split out of lib/rpc.ts,
// which re-exports both, so `import { RpcError, errorText } from './rpc.ts'` keeps working).
// Owns: the error shape and its user-safe text. Never: the connection.

import type { ErrorCode, WorkforceErrorData } from '../../shared/errors.ts';

/** Error thrown by rpc.call: carries the runtime's safe error code + message. */
export class RpcError extends Error {
  readonly code: ErrorCode;
  readonly data: WorkforceErrorData;
  constructor(data: WorkforceErrorData) {
    super(data.message);
    this.name = 'RpcError';
    this.code = data.code;
    this.data = data;
  }
}

/** Short user-safe text for any error thrown by rpc.call. */
export function errorText(error: unknown): string {
  if (error instanceof RpcError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}
