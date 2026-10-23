import type { BridgeFailure } from "../project/bridge";

export const sessionErrorResponse = (value: unknown): BridgeFailure => {
  // SAFETY: value may be an Error instance, object with message/code, or arbitrary thrown value.
  const error = value as { message?: string; code?: string } | null;
  return {
    error: error?.message || String(value),
    success: false,
    ...(error?.code ? { code: error.code } : {}),
  };
};
