import type HttpServer = require("./http-server");
import type {
  ActionData,
  CapturedTarget,
  HttpApprovalAction,
  HttpApprovalRequest,
  HttpApprovalDecision,
  HttpActionResponse,
  HttpVault,
} from "./http-server-contracts";

const sameEnvironmentIdentity = (
  left: CapturedTarget["identity"],
  right: CapturedTarget["identity"]
): boolean =>
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.environmentId === right.environmentId &&
  left.environmentName === right.environmentName &&
  left.environmentIncarnation === right.environmentIncarnation;
const invalidTargetError = (): Error => {
  const error = new Error(
    "A valid Project and Environment selector is required"
  );
  error.code = "ENVIRONMENT_TARGET_INVALID";
  return error;
};
export const staleTargetError = (): Error => {
  const error = new Error("Target changed. Request approval again.");
  error.code = "ENVIRONMENT_TARGET_STALE";
  return error;
};
const ignoreAbort = () => {
  // Assigned before awaiting the abortable request.
};
const SESSION_STATE_ERRORS = new Map<string, string>([
  ["VAULT_SESSION_LOCKED", "Vault is locked"],
  ["VAULT_SESSION_OPENING", "Vault is opening"],
  ["VAULT_SESSION_RECOVERING", "Vault recovery is required"],
  ["VAULT_SESSION_CLOSING", "Vault is closing"],
  ["VAULT_SESSION_DESTROYING", "Vault is being deleted"],
]);

export const httpPublicError = (
  error:
    | {
        code?: string;
        message?: string;
      }
    | null
    | undefined
): HttpActionResponse => {
  const code = error?.code;
  const message =
    SESSION_STATE_ERRORS.get(code ?? "") || error?.message || String(error);
  const out: HttpActionResponse = { error: message, success: false };
  if (code) {
    out.code = code;
  }
  return out;
};

export const httpThrowIfAborted = (signal: AbortSignal | null) => {
  if (!signal?.aborted) {
    return;
  }
  const { reason } = signal;
  if (reason instanceof Error) {
    throw reason;
  }
  const error = new Error("Request cancelled");
  error.code = "VAULT_SESSION_CLOSING";
  throw error;
};

export const httpAwaitWithAbort = async <T>(
  bridge: HttpServer,
  promise: Promise<T>,
  signal: AbortSignal | null
): Promise<T> => {
  bridge._throwIfAborted(signal);
  if (!signal || typeof signal.addEventListener !== "function") {
    return await promise;
  }
  let onAbort: () => void = ignoreAbort;
  // AbortSignal supplies an event rather than a Promise.
  // eslint-disable-next-line promise/avoid-new
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      try {
        bridge._throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

/**
 * Resolves the external selector exactly once. An omitted Environment name
 * resolves to the Project default; an explicitly supplied but malformed,
 * conflicting, or unknown Environment is rejected before approval instead of
 * degrading to the default.
 */

export const httpCaptureTarget = (
  bridge: HttpServer,
  vault: HttpVault,
  data: ActionData
): CapturedTarget => {
  if (
    !data ||
    typeof data.projectName !== "string" ||
    data.projectName.trim().length === 0 ||
    Object.hasOwn(data, "environmentId") ||
    (Object.hasOwn(data, "environmentName") &&
      (typeof data.environmentName !== "string" ||
        data.environmentName.trim().length === 0))
  ) {
    throw invalidTargetError();
  }
  const selector = Object.hasOwn(data, "environmentName")
    ? {
        environmentName: data.environmentName as string,
        projectName: data.projectName,
      }
    : { projectName: data.projectName };
  const target = vault.resolveEnvironmentTarget(selector);
  const identity = vault.getEnvironmentTargetIdentity(target);
  const vaultId = vault.getVaultId?.() || null;
  const vaultName =
    bridge.vaultManager
      ?.getVaultList?.()
      .find((entry: { id: string; name: string }) => entry.id === vaultId)
      ?.name || (vaultId === "system" || vaultId === null ? "System" : "Vault");
  return {
    identity: {
      environmentId: identity.environmentId,
      environmentIncarnation: identity.environmentIncarnation,
      environmentName: identity.environmentName,
      projectIncarnation: identity.projectIncarnation,
      projectName: identity.projectName,
    },
    target,
    vaultId,
    vaultInstanceId: vault.getVaultInstanceId?.() || null,
    vaultName,
  };
};

/**
 * Every Secret read resolves the target again so a resolution failure can
 * never be swallowed and answered with credentials from another collection.
 */

export const httpReadSecrets = (
  vault: HttpVault,
  captured: CapturedTarget
): Record<string, unknown> => {
  const target = vault.resolveEnvironmentTarget({
    environmentId: captured.target.environmentId,
    projectName: captured.target.projectName,
  });
  return vault.getSecrets(target);
};

export const httpReadSecret = (
  vault: HttpVault,
  captured: CapturedTarget,
  key: string
) => {
  const target = vault.resolveEnvironmentTarget({
    environmentId: captured.target.environmentId,
    projectName: captured.target.projectName,
  });
  return vault.getSecret(target, key);
};

export const httpAssertFreshTarget = (
  vault: HttpVault,
  captured: CapturedTarget,
  expectedSecrets?: Parameters<HttpServer["_assertFreshTarget"]>[2]
) => {
  const current = vault.getEnvironmentTargetIdentity(captured.target);
  if (
    !sameEnvironmentIdentity(captured.identity, current) ||
    (captured.vaultInstanceId &&
      vault.getVaultInstanceId?.() !== captured.vaultInstanceId) ||
    (captured.vaultId && vault.getVaultId?.() !== captured.vaultId)
  ) {
    throw staleTargetError();
  }
  if (
    expectedSecrets !== undefined &&
    JSON.stringify(vault.getSecrets(captured.target)) !==
      JSON.stringify(expectedSecrets)
  ) {
    throw staleTargetError();
  }
};

export const httpApprovalRequest = (
  captured: CapturedTarget,
  keys: string[],
  action: HttpApprovalAction
): HttpApprovalRequest => ({
  action,
  environmentId: captured.identity.environmentId,
  environmentName: captured.identity.environmentName,
  keys,
  projectName: captured.identity.projectName,
  vaultId: captured.vaultId,
  vaultInstanceId: captured.vaultInstanceId,
  vaultName: captured.vaultName,
});

export const httpLogTarget = (captured: CapturedTarget) => ({
  action: "write" as const,
  environmentId: captured.identity.environmentId,
  environmentName: captured.identity.environmentName,
  projectName: captured.identity.projectName,
  vaultId: captured.vaultId,
  vaultInstanceId: captured.vaultInstanceId,
});

export const httpLogCompletedRead = (
  bridge: HttpServer,
  captured: CapturedTarget,
  keys: string[]
) => {
  bridge.logger?.logAccess?.(
    "Secret read",
    captured.identity.projectName,
    keys,
    { ...bridge._logTarget(captured), action: "read", outcome: "approved" }
  );
};

export const httpRequestBatchApproval = async (
  bridge: HttpServer,
  request: HttpApprovalRequest,
  signal: AbortSignal | null = null
): Promise<HttpApprovalDecision> => {
  if (!bridge.approvalCallback) {
    return { approved: false, reason: "No approval handler available" };
  }
  // Defer the callback into a microtask and read the current handler there.
  // eslint-disable-next-line promise/prefer-await-to-then
  const approval = Promise.resolve().then(() => {
    const handler = bridge.approvalCallback;
    if (!handler) {
      throw new TypeError("Approval handler is unavailable");
    }
    return handler(request, signal);
  });
  return await bridge._awaitWithAbort(approval, signal);
};
