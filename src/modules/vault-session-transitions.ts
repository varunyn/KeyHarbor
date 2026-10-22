/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CLOSE_PRIORITY,
  STATE_ERROR_CODES,
  VaultSessionError,
  compact,
  immutableCopy,
  requireMethod,
  safeOptionalString,
  sanitizeArtifacts,
  sanitizeVaultStatuses,
  sanitizeWarnings,
  sessionError,
  throwIfAborted,
} from "./vault-session-helpers.js";
import { stopMonitors } from "./vault-session-monitors.js";
import {
  abortLeases,
  activateRuntime,
  deactivateRuntime,
  disableIngress,
  drainLeases,
  persistRecovery,
  restoreActiveRuntime,
  rollbackOpen,
} from "./vault-session-runtime.js";
import type {
  ArtifactEntry,
  CloseReason,
  CloseResult,
  DestroyResult,
  OpenRequest,
  OpenResult,
  SessionState,
  VaultSessionHost,
  VaultStatusEntry,
} from "./vault-session-types.js";

export const buildOpenResult = (
  session: VaultSessionHost,
  outcome: string,
  provisioned: boolean
): OpenResult =>
  immutableCopy({
    outcome,
    provisioned,
    state: session._state,
    transitionId: session._transitionId,
    vaults: session._vaults,
    warnings: session._warnings,
  });

export const buildCloseResult = (
  session: VaultSessionHost,
  outcome: string,
  reason: CloseReason,
  vaults: VaultStatusEntry[]
): CloseResult =>
  immutableCopy({
    outcome,
    reason,
    state: session._state,
    transitionId: session._transitionId,
    vaults,
    warnings: session._warnings,
  });

export const buildDestroyResult = (
  session: VaultSessionHost,
  outcome: string,
  artifacts: ArtifactEntry[]
): DestroyResult =>
  immutableCopy({
    artifacts,
    outcome,
    state: session._state,
    transitionId: session._transitionId,
  });

export const getActiveVaultId = (session: VaultSessionHost): string => {
  const manager = session.vaultManager as {
    getActiveVaultId?: () => string;
  };
  if (typeof manager.getActiveVaultId === "function") {
    return manager.getActiveVaultId();
  }
  return (
    session._vaults.find((entry) => entry.status === "active")?.vaultId ??
    "system"
  );
};

export const errorForState = (session: VaultSessionHost): VaultSessionError => {
  const code =
    STATE_ERROR_CODES[session._state] || "VAULT_SESSION_TRANSITION_IN_PROGRESS";
  return sessionError(code, `Vault session is ${session._state}`);
};

export const trackTransition = (
  session: VaultSessionHost,
  kind: string,
  promise: Promise<unknown>
): void => {
  session._transitionKind = kind;
  session._transitionPromise = promise;
};

export const clearTransition = (
  session: VaultSessionHost,
  promise: Promise<unknown>
): void => {
  if (session._transitionPromise !== promise) {
    return;
  }
  session._transitionPromise = null;
  session._transitionKind = null;
};

export const recordWarning = (
  session: VaultSessionHost,
  code: string
): void => {
  if (!session._warnings.some((warning) => warning.code === code)) {
    session._warnings.push({ code });
  }
};

export const logFinalShutdownRecord = (session: VaultSessionHost): void => {
  if (!session.logger) {
    return;
  }
  const logger = session.logger as {
    log?: (msg: string) => void;
    logApp?: (msg: string) => void;
    logLock?: (msg: string) => void;
  };
  const log = logger.logLock || logger.logApp || logger.log;
  if (typeof log === "function") {
    try {
      log.call(
        session.logger,
        `Vault session ${session._transitionId} closing for quit`
      );
    } catch {
      // Logging failure must not prevent shutdown.
    }
  }
};

export const upgradeCloseReason = (
  session: VaultSessionHost,
  reason: CloseReason
): void => {
  const currentReason = session._closeReason;
  if (currentReason && CLOSE_PRIORITY[reason] > CLOSE_PRIORITY[currentReason]) {
    session._closeReason = reason;
    session._reason = reason;
    abortLeases(session);
  }
};

export const performOpen = async (
  session: VaultSessionHost,
  request: OpenRequest,
  credential: Buffer | string,
  signal: AbortSignal
): Promise<OpenResult> => {
  let provisioned = false;
  try {
    await disableIngress(session);
    stopMonitors(session);
    const store = session.recoveryStore as {
      enumerate?: () => Promise<unknown[]>;
    } | null;
    const headers =
      store && typeof store.enumerate === "function"
        ? await store.enumerate()
        : [];
    throwIfAborted(signal);
    const opener = requireMethod(session.vaultManager, "openSession");
    const result =
      ((await opener.call(session.vaultManager, {
        credential,
        method: request.method,
        reason: request.reason,
        recoveryHeaders: headers,
        signal,
      })) as {
        provisioned?: boolean;
        recovery?: unknown[];
        state?: SessionState;
      }) || {};
    provisioned = result.provisioned === true;
    throwIfAborted(signal);
    session._captureRuntime(result);

    if (session._recovery.length > 0 || result.state === "recovering") {
      session._setState("recovering", session._reason);
      return buildOpenResult(session, "recovery_required", provisioned);
    }

    await activateRuntime(session);
    throwIfAborted(signal);
    session._setState("active", null);
    return buildOpenResult(session, "opened", provisioned);
  } catch (error) {
    await rollbackOpen(session);
    session._setState("locked", null);
    if (
      error instanceof VaultSessionError &&
      error.code !== "VAULT_SESSION_CLOSING" &&
      error.code !== "VAULT_SESSION_DESTROYING"
    ) {
      throw error;
    }
    const wrapped = sessionError(
      "VAULT_SESSION_OPEN_FAILED",
      "Vault session could not be opened",
      { provisioned }
    );
    wrapped.cause = error;
    throw wrapped;
  }
};

const handleDrainTimeout = async (
  session: VaultSessionHost,
  reason: CloseReason
): Promise<CloseResult | null> => {
  if (reason === "idle") {
    await drainLeases(session, undefined, true);
    return null;
  }
  if (reason === "manual") {
    await restoreActiveRuntime(session);
    session._setState("active", null);
  }
  return buildCloseResult(session, "drain_timeout", reason, []);
};

const prepareVaultStatuses = async (
  session: VaultSessionHost,
  reason: CloseReason
): Promise<{ reason: CloseReason; vaults: VaultStatusEntry[] }> => {
  if (session._recovery.length > 0) {
    return { reason, vaults: [] };
  }
  const prepare = requireMethod(session.vaultManager, "prepareClose");
  const prepared =
    ((await prepare.call(session.vaultManager, { reason })) as {
      config?: { code?: unknown; status?: string };
      results?: unknown[];
      vaults?: unknown[];
      warnings?: unknown[];
    }) || {};
  const vaults = sanitizeVaultStatuses(
    prepared.vaults ?? prepared.results ?? []
  );
  if (
    prepared.config &&
    typeof prepared.config.status === "string" &&
    !vaults.some((entry) => entry.vaultId === "manager_config")
  ) {
    vaults.push(
      compact({
        code: safeOptionalString(prepared.config.code),
        status: prepared.config.status,
        vaultId: "manager_config",
      })
    );
  }
  session._warnings = sanitizeWarnings(prepared.warnings ?? []);
  return { reason: session._closeReason ?? "manual", vaults };
};

export const performClose = async (
  session: VaultSessionHost,
  deadlineMs?: number
): Promise<CloseResult> => {
  await disableIngress(session);
  stopMonitors(session);
  abortLeases(session);

  const reasonAtDrain = session._closeReason;
  const drained = await drainLeases(
    session,
    deadlineMs,
    reasonAtDrain === "idle"
  );
  if (!drained) {
    const drainResult = await handleDrainTimeout(
      session,
      session._closeReason ?? "manual"
    );
    if (drainResult) {
      return drainResult;
    }
  }

  const { reason, vaults: preparedVaults } = await prepareVaultStatuses(
    session,
    session._closeReason ?? "manual"
  );
  let vaults = preparedVaults;

  const blocked = vaults.some(
    (entry) => entry.status === "needs_resolution" || entry.status === "failed"
  );
  if (reason === "manual" && blocked) {
    await restoreActiveRuntime(session);
    session._setState("active", null);
    return buildCloseResult(session, "blocked", reason, vaults);
  }

  let recoveryFailed = false;
  if ((reason === "idle" || reason === "quit") && blocked) {
    const recovery = await persistRecovery(session, vaults);
    ({ failed: recoveryFailed, vaults } = recovery);
  }

  if (reason === "quit") {
    logFinalShutdownRecord(session);
  }
  await deactivateRuntime(session, { seal: true });
  session._setState("locked", null);
  return buildCloseResult(
    session,
    recoveryFailed ? "recovery_failed" : "closed",
    reason,
    vaults
  );
};

export const performDestroy = async (
  session: VaultSessionHost,
  deadlineMs: number | undefined,
  previousState: SessionState,
  resuming: boolean
): Promise<DestroyResult> => {
  await disableIngress(session);
  stopMonitors(session);
  abortLeases(session);
  const drained = await drainLeases(session, deadlineMs, false);
  if (!drained) {
    if (previousState === "active") {
      await restoreActiveRuntime(session);
    }
    session._setState(previousState, null);
    return buildDestroyResult(session, "drain_timeout", []);
  }

  const store = session.recoveryStore as {
    beginDestruction?: () => Promise<void>;
    finishDestruction?: () => Promise<void>;
  } | null;
  if (!resuming && store && typeof store.beginDestruction === "function") {
    await store.beginDestruction();
  }
  await deactivateRuntime(session, { seal: true });
  const destroyer = requireMethod(session.vaultManager, "destroySession");
  const result =
    ((await destroyer.call(session.vaultManager, { resume: resuming })) as {
      alreadyAbsent?: boolean;
      artifacts?: unknown[];
      partialFailure?: boolean;
      warnings?: unknown[];
    }) || {};
  const artifacts = sanitizeArtifacts(result.artifacts ?? []);
  const failed = artifacts.some((entry) => entry.status === "failed");
  if (!failed && store && typeof store.finishDestruction === "function") {
    await store.finishDestruction();
  }
  session._vaults = [];
  session._warnings = sanitizeWarnings(result.warnings ?? []);
  session._recovery = [];
  session._setState("locked", null);
  const completedOutcome = result.alreadyAbsent
    ? "already_absent"
    : "destroyed";
  return buildDestroyResult(
    session,
    failed || result.partialFailure ? "partial_failure" : completedOutcome,
    artifacts
  );
};
