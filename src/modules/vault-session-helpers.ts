/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  CloseReason,
  CloseRequest,
  DestroyRequest,
  MonitorScheduler,
  OpenRequest,
  RecoveryDecision,
  RecoveryEntry,
  RecoveryKind,
  RecoveryRequest,
  SessionPolicy,
  SessionPolicyInput,
  SessionState,
  VaultStatusEntry,
  WarningEntry,
} from "./vault-session-types.js";

export { setTimeout as delay } from "node:timers/promises";

export const STATE_ERROR_CODES: Record<SessionState, string> = Object.freeze({
  active: "VAULT_SESSION_ACTIVE",
  closing: "VAULT_SESSION_CLOSING",
  destroying: "VAULT_SESSION_DESTROYING",
  locked: "VAULT_SESSION_LOCKED",
  opening: "VAULT_SESSION_OPENING",
  recovering: "VAULT_SESSION_RECOVERING",
});

export const CLOSE_PRIORITY: Record<CloseReason, number> = Object.freeze({
  idle: 1,
  manual: 0,
  quit: 2,
});

export const SENSITIVE_KEY_PATTERN =
  /credential|password|secret|key|data|payload|bytes/iu;

export const OPEN_METHODS = new Set(["setup", "password", "key"]);
export const OPEN_REASONS = new Set(["setup", "manual", "touch_id"]);
export const CLOSE_REASONS = new Set(["manual", "idle", "quit"]);
export const RECOVERY_DECISIONS = new Set([
  "keep_recovered",
  "use_current",
  "discard",
  "defer",
]);

export const sanitizeDetails = (
  details: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeDetails(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object"
          ? sanitizeDetails(item as Record<string, unknown>)
          : item
      );
    } else {
      result[key] = value;
    }
  }
  return result;
};

export class VaultSessionError extends Error {
  code: string;
  details?: Record<string, unknown>;
  cause?: unknown;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "VaultSessionError";
    this.code = code;
    if (details && typeof details === "object") {
      this.details = sanitizeDetails(details);
    }
  }
}

export const sessionError = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): VaultSessionError => new VaultSessionError(code, message, details);

export const defaultScheduler = (): MonitorScheduler => ({
  clearInterval: (handle: unknown) => {
    clearInterval(handle as NodeJS.Timeout);
  },
  getIdleTimeSeconds: () => 0,
  setInterval: (callback: () => void, milliseconds: number) =>
    setInterval(callback, milliseconds),
});

const DEFAULT_SESSION_POLICY: SessionPolicy = Object.freeze({
  autoLockEnabled: false,
  autoLockTimeoutSeconds: 1800,
  diskSyncIntervalMs: 5000,
});

export const normalizePolicy = (
  input: unknown,
  fallback: SessionPolicy = DEFAULT_SESSION_POLICY
): SessionPolicy => {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as SessionPolicyInput)
      : {};
  const autoLockEnabled =
    source.autoLockEnabled ?? fallback.autoLockEnabled ?? false;
  const autoLockTimeoutSeconds =
    source.autoLockTimeoutSeconds ?? fallback.autoLockTimeoutSeconds ?? 1800;
  const diskSyncIntervalMs =
    source.diskSyncIntervalMs ?? fallback.diskSyncIntervalMs ?? 5000;

  if (typeof autoLockEnabled !== "boolean") {
    throw new TypeError("autoLockEnabled must be boolean");
  }
  if (!Number.isFinite(autoLockTimeoutSeconds) || autoLockTimeoutSeconds <= 0) {
    throw new TypeError("autoLockTimeoutSeconds must be positive");
  }
  if (!Number.isFinite(diskSyncIntervalMs) || diskSyncIntervalMs < 0) {
    throw new TypeError("diskSyncIntervalMs must be non-negative");
  }

  return Object.freeze({
    autoLockEnabled,
    autoLockTimeoutSeconds: Math.floor(autoLockTimeoutSeconds),
    diskSyncIntervalMs: Math.floor(diskSyncIntervalMs),
  });
};

export const readInitialPolicy = (provider: unknown): SessionPolicyInput => {
  if (!provider) {
    return {};
  }
  if (
    typeof provider === "object" &&
    "getPolicy" in provider &&
    typeof (provider as { getPolicy: unknown }).getPolicy === "function"
  ) {
    return (
      (provider as { getPolicy: () => SessionPolicyInput }).getPolicy() || {}
    );
  }
  if (typeof provider === "function") {
    return (provider as () => SessionPolicyInput)() || {};
  }
  return {};
};

export const validateOpenRequest = (request: Partial<OpenRequest>): void => {
  if (!OPEN_METHODS.has(request.method as string)) {
    throw new TypeError("Invalid Vault session open method");
  }
  if (!OPEN_REASONS.has(request.reason as string)) {
    throw new TypeError("Invalid Vault session open reason");
  }
  if (request.credential === null || request.credential === undefined) {
    throw new TypeError("A credential is required");
  }
};

export const validateCloseRequest = (request: Partial<CloseRequest>): void => {
  if (!CLOSE_REASONS.has(request.reason as string)) {
    throw new TypeError("Invalid Vault session close reason");
  }
  if (
    request.deadlineMs !== undefined &&
    (!Number.isFinite(request.deadlineMs) || request.deadlineMs < 0)
  ) {
    throw new TypeError("deadlineMs must be a non-negative number");
  }
};

export const validateDestroyRequest = (
  request: Partial<DestroyRequest>
): void => {
  if (request.confirmation !== "delete") {
    throw new TypeError("Destruction requires exact confirmation");
  }
  if (
    request.deadlineMs !== undefined &&
    (!Number.isFinite(request.deadlineMs) || request.deadlineMs < 0)
  ) {
    throw new TypeError("deadlineMs must be a non-negative number");
  }
};

export const validateRecoveryRequest = (
  request: Partial<RecoveryRequest>
): void => {
  if (request.kind !== "vault" && request.kind !== "manager_config") {
    throw new TypeError("Invalid recovery kind");
  }
  if (typeof request.artifactId !== "string" || !request.artifactId) {
    throw new TypeError("artifactId is required");
  }
  if (typeof request.capsuleId !== "string" || !request.capsuleId) {
    throw new TypeError("capsuleId is required");
  }
  if (!RECOVERY_DECISIONS.has(request.decision as string)) {
    throw new TypeError("Invalid recovery decision");
  }
};

export const copyCredential = (credential: Buffer | string): Buffer | string =>
  Buffer.isBuffer(credential) ? Buffer.from(credential) : credential;

export const zeroCredential = (credential: Buffer | string): void => {
  if (Buffer.isBuffer(credential)) {
    credential.fill(0);
  }
};

export const requireMethod = (
  target: unknown,
  name: string
): ((...args: unknown[]) => any) => {
  if (
    !target ||
    typeof (target as Record<string, unknown>)[name] !== "function"
  ) {
    throw new TypeError(`Target must implement ${name}()`);
  }
  return (target as Record<string, (...args: unknown[]) => any>)[name];
};

export const safeString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export const safeOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const compact = <T extends Record<string, unknown>>(object: T): T => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
};

export const sanitizeVaultStatuses = (
  entries: unknown[]
): VaultStatusEntry[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry: any) => {
    const status =
      typeof entry?.status === "string"
        ? entry.status
        : safeString(entry?.status, "failed");
    return compact({
      code: safeOptionalString(entry?.code),
      status,
      vaultId: safeString(entry?.vaultId, "unknown"),
    });
  });
};

export const sanitizeWarnings = (entries: unknown[]): WarningEntry[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry: any) =>
    compact({
      code: safeString(entry?.code, "UNKNOWN_WARNING"),
      vaultId: safeOptionalString(entry?.vaultId),
    })
  );
};

export const sanitizeRecovery = (entries: unknown[]): RecoveryEntry[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry: any) => ({
    allowedDecisions: Array.isArray(entry?.allowedDecisions)
      ? entry.allowedDecisions.filter(
          (value: unknown): value is RecoveryDecision =>
            typeof value === "string" && RECOVERY_DECISIONS.has(value)
        )
      : [],
    artifactId: safeString(entry?.artifactId, "unknown"),
    capsuleId: safeString(entry?.capsuleId, "unknown"),
    kind: (entry?.kind === "manager_config"
      ? "manager_config"
      : "vault") as RecoveryKind,
    reason: safeString(entry?.reason, "recovery_required"),
  }));
};

export const sanitizeArtifacts = (entries: unknown[]): any[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry: any) =>
    compact({
      code: safeOptionalString(entry?.code),
      kind: safeString(entry?.kind, "unknown"),
      status: safeString(entry?.status, "failed"),
    })
  );
};

export const deepFreeze = <T>(object: T): T => {
  if (!object || typeof object !== "object") {
    return object;
  }
  Object.freeze(object);
  for (const value of Object.values(object)) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return object;
};

export const immutableCopy = <T>(value: T): T =>
  deepFreeze(structuredClone(value));

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    const error =
      signal.reason instanceof Error
        ? signal.reason
        : sessionError("VAULT_SESSION_CANCELLED", "Operation was cancelled");
    throw error;
  }
};
