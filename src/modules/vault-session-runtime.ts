/* eslint-disable @typescript-eslint/no-explicit-any */
import { delay, requireMethod, sessionError } from "./vault-session-helpers.js";
import { startMonitors, stopMonitors } from "./vault-session-monitors.js";
import type {
  OperationContext,
  SecurityContext,
  VaultSessionHost,
  VaultStatusEntry,
} from "./vault-session-types.js";

export const clearLoggerKey = (session: VaultSessionHost): void => {
  if (Buffer.isBuffer(session._loggerKey)) {
    session._loggerKey.fill(0);
  }
  session._loggerKey = null;
};

export const enableIngress = async (
  session: VaultSessionHost
): Promise<void> => {
  if (!session.httpIngress) {
    return;
  }
  const ingress = session.httpIngress as {
    enable?: () => Promise<void>;
    enableSensitive?: () => Promise<void>;
  };
  const enable = ingress.enableSensitive || ingress.enable;
  if (typeof enable === "function") {
    await enable.call(session.httpIngress);
  }
};

export const disableIngress = async (
  session: VaultSessionHost
): Promise<void> => {
  if (!session.httpIngress) {
    return;
  }
  const ingress = session.httpIngress as {
    disable?: () => Promise<void>;
    disableSensitive?: () => Promise<void>;
  };
  const disable = ingress.disableSensitive || ingress.disable;
  if (typeof disable === "function") {
    await disable.call(session.httpIngress);
  }
};

export const activateRuntime = async (
  session: VaultSessionHost
): Promise<void> => {
  if (
    session.logger &&
    session._loggerKey !== null &&
    session._loggerKey !== undefined
  ) {
    const logger = session.logger as {
      installKey?: (key: Buffer) => Promise<void>;
      setEncryptionKey?: (key: Buffer) => Promise<void>;
    };
    const install = logger.setEncryptionKey || logger.installKey;
    if (typeof install === "function") {
      await install.call(session.logger, session._loggerKey);
    }
  }
  await enableIngress(session);
  startMonitors(session);
};

export const restoreActiveRuntime = async (
  session: VaultSessionHost
): Promise<void> => {
  await enableIngress(session);
  startMonitors(session, true);
};

export const deactivateRuntime = async (
  session: VaultSessionHost,
  { seal }: { seal: boolean }
): Promise<void> => {
  stopMonitors(session);
  await disableIngress(session);
  if (session.logger) {
    const logger = session.logger as {
      clearEncryptionKey?: () => Promise<void>;
      clearKey?: () => Promise<void>;
    };
    const clear = logger.clearEncryptionKey || logger.clearKey;
    if (typeof clear === "function") {
      await clear.call(session.logger);
    }
  }
  clearLoggerKey(session);
  const manager = session.vaultManager as {
    resetSession?: () => Promise<void>;
    sealSession?: () => Promise<void>;
  };
  if (seal && typeof manager.sealSession === "function") {
    await manager.sealSession();
  }
  if (seal && typeof manager.resetSession === "function") {
    await manager.resetSession();
  }
  session._contextFactory = null;
  session._vaults = [];
  session._recovery = [];
};

export const rollbackOpen = async (
  session: VaultSessionHost
): Promise<void> => {
  stopMonitors(session);
  await disableIngress(session);
  const manager = session.vaultManager as {
    rollbackOpen?: () => Promise<void>;
    sealSession?: () => Promise<void>;
  };
  if (typeof manager.rollbackOpen === "function") {
    try {
      await manager.rollbackOpen();
    } catch {
      // Rollback is best effort; remaining runtime cleanup must still run.
    }
  } else if (typeof manager.sealSession === "function") {
    try {
      await manager.sealSession();
    } catch {
      // Rollback is best effort; remaining runtime cleanup must still run.
    }
  }
  if (session.logger) {
    const logger = session.logger as {
      clearEncryptionKey?: () => Promise<void>;
      clearKey?: () => Promise<void>;
    };
    const clear = logger.clearEncryptionKey || logger.clearKey;
    if (typeof clear === "function") {
      try {
        await clear.call(session.logger);
      } catch {
        // Rollback is best effort; remaining runtime cleanup must still run.
      }
    }
  }
  clearLoggerKey(session);
  session._contextFactory = null;
  session._vaults = [];
  session._recovery = [];
};

export const createOperationContext = (
  session: VaultSessionHost,
  signal: AbortSignal
): OperationContext => {
  let context: Record<string, any>;
  const manager = session.vaultManager as {
    createSessionContext?: (sig: AbortSignal) => Record<string, any>;
    getSessionContext?: (sig: AbortSignal) => Record<string, any>;
  };
  if (session._contextFactory) {
    context = session._contextFactory(signal);
  } else if (typeof manager.createSessionContext === "function") {
    context = manager.createSessionContext(signal);
  } else if (typeof manager.getSessionContext === "function") {
    context = manager.getSessionContext(signal);
  } else {
    throw new TypeError(
      "vaultManager must provide createSessionContext(signal)"
    );
  }

  const baseSecurity =
    context.security && typeof context.security === "object"
      ? (context.security as Record<string, any>)
      : {};
  const security: SecurityContext = Object.freeze({
    ...baseSecurity,
    changePassword: async (
      currentPassword: string,
      newPassword: string
    ): Promise<unknown> => {
      const rotate = requireMethod(
        session.vaultManager,
        "changeSystemPassword"
      );
      const result = await rotate.call(
        session.vaultManager,
        currentPassword,
        newPassword
      );
      const copyKey = requireMethod(session.vaultManager, "copySystemKey");
      const key: Buffer = copyKey.call(session.vaultManager);
      try {
        clearLoggerKey(session);
        session._loggerKey = Buffer.from(key);
        if (session.logger) {
          const logger = session.logger as {
            installKey?: (k: Buffer) => Promise<void>;
            setEncryptionKey?: (k: Buffer) => Promise<void>;
          };
          const install = logger.setEncryptionKey || logger.installKey;
          if (typeof install === "function") {
            await install.call(session.logger, session._loggerKey);
          }
        }
        const coordinator = session.securityCoordinator as {
          afterKeyRotation?: (k: Buffer) => Promise<void>;
        } | null;
        if (coordinator && typeof coordinator.afterKeyRotation === "function") {
          await coordinator.afterKeyRotation(key);
        }
      } finally {
        key.fill(0);
      }
      return result;
    },
  });

  return Object.freeze({ ...context, security, signal });
};

export const abortLeases = (session: VaultSessionHost): void => {
  for (const lease of session._leases) {
    lease.controller.abort(
      sessionError("VAULT_SESSION_CLOSING", "Session is closing")
    );
  }
};

export const drainLeases = async (
  session: VaultSessionHost,
  deadlineMs?: number,
  ignoreDeadline = false
): Promise<boolean> => {
  const pending: Promise<unknown>[] = [...session._leases].map(
    (lease) => lease.settled
  );
  pending.push(...session._monitorTicks);
  if (pending.length === 0) {
    return true;
  }
  const drain = Promise.allSettled(pending);
  if (ignoreDeadline || deadlineMs === null || deadlineMs === undefined) {
    await drain;
    return true;
  }
  const drainPromise = (async () => {
    await drain;
    return true;
  })();
  const timeoutPromise = (async () => {
    await delay(deadlineMs);
    return false;
  })();
  return await Promise.race([drainPromise, timeoutPromise]);
};

export const persistRecovery = async (
  session: VaultSessionHost,
  vaults: VaultStatusEntry[]
): Promise<{ failed: boolean; vaults: VaultStatusEntry[] }> => {
  const store = session.recoveryStore as {
    writeCapsule?: (record: unknown) => Promise<void>;
  } | null;
  if (!store || typeof store.writeCapsule !== "function") {
    return { failed: true, vaults };
  }
  const writeCapsule = store.writeCapsule.bind(store);
  const manager = session.vaultManager as {
    getRecoveryRecord?: (id: string) => Promise<unknown>;
  };
  const next = await Promise.all(
    vaults.map(async (entry): Promise<VaultStatusEntry> => {
      if (entry.status !== "failed" && entry.status !== "needs_resolution") {
        return entry;
      }
      try {
        const record =
          typeof manager.getRecoveryRecord === "function"
            ? await manager.getRecoveryRecord(entry.vaultId)
            : { vaultId: entry.vaultId };
        await writeCapsule(record);
        return { status: "recovered", vaultId: entry.vaultId };
      } catch {
        return {
          code: "VAULT_SESSION_RECOVERY_FAILED",
          status: "failed",
          vaultId: entry.vaultId,
        };
      }
    })
  );
  return {
    failed: next.some((entry) => entry.status === "failed"),
    vaults: next,
  };
};

export const hasDestructionTombstone = async (
  session: VaultSessionHost
): Promise<boolean> => {
  const store = session.recoveryStore as {
    hasDestructionTombstone?: () => Promise<boolean>;
  } | null;
  return Boolean(
    store &&
    typeof store.hasDestructionTombstone === "function" &&
    (await store.hasDestructionTombstone())
  );
};
