import { STATE_ERROR_CODES } from "./vault-session-helpers.js";
import type { VaultSessionHost } from "./vault-session-types.js";

const STATE_ERROR_CODE_SET = new Set(Object.values(STATE_ERROR_CODES));

export const isStateError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string" &&
  STATE_ERROR_CODE_SET.has(error.code);

export const runMonitorTick = (
  session: VaultSessionHost,
  generation: number,
  operation: () => Promise<unknown> | unknown
): void => {
  if (
    generation !== session._monitorGeneration ||
    session._state !== "active"
  ) {
    return;
  }
  const handle: { current: Promise<void> | null } = { current: null };
  const execute = async (): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      if (!isStateError(error)) {
        session._recordWarning("VAULT_SESSION_MONITOR_FAILED");
      }
    } finally {
      if (handle.current) {
        session._monitorTicks.delete(handle.current);
      }
    }
  };
  const promise = execute();
  handle.current = promise;
  session._monitorTicks.add(promise);
};

export const runAutoLockTick = (
  session: VaultSessionHost,
  generation: number
): void => {
  if (
    generation !== session._monitorGeneration ||
    session._state !== "active"
  ) {
    return;
  }
  void (async () => {
    try {
      const idle = await session.monitorScheduler.getIdleTimeSeconds();
      if (
        generation !== session._monitorGeneration ||
        session._state !== "active"
      ) {
        return;
      }
      if (idle >= session._policy.autoLockTimeoutSeconds) {
        await session.close({ reason: "idle" });
      }
    } catch (error) {
      if (!isStateError(error)) {
        session._recordWarning("VAULT_SESSION_MONITOR_FAILED");
      }
    }
  })();
};

export const stopMonitors = (session: VaultSessionHost): void => {
  session._monitorGeneration += 1;
  if (session._monitorHandles.autoLock) {
    session.monitorScheduler.clearInterval(session._monitorHandles.autoLock);
    session._monitorHandles.autoLock = null;
  }
  if (session._monitorHandles.diskSync) {
    session.monitorScheduler.clearInterval(session._monitorHandles.diskSync);
    session._monitorHandles.diskSync = null;
  }
};

export const startMonitors = (
  session: VaultSessionHost,
  force = false
): void => {
  stopMonitors(session);
  if (!force && session._state !== "active" && session._state !== "opening") {
    return;
  }
  const generation = session._monitorGeneration;
  const { autoLockEnabled, autoLockTimeoutSeconds, diskSyncIntervalMs } =
    session._policy;

  if (autoLockEnabled && autoLockTimeoutSeconds > 0) {
    session._monitorHandles.autoLock = session.monitorScheduler.setInterval(
      () => {
        runAutoLockTick(session, generation);
      },
      Math.min(10_000, autoLockTimeoutSeconds * 1000)
    );
  }

  if (diskSyncIntervalMs > 0) {
    session._monitorHandles.diskSync = session.monitorScheduler.setInterval(
      () => {
        runMonitorTick(session, generation, async () => {
          await session.withActiveSession((context) => {
            if (
              context.vaults &&
              typeof context.vaults.syncAll === "function"
            ) {
              return context.vaults.syncAll();
            }
            // SAFETY: Only the optional method is accessed, and its callability is checked below.
            const manager = session.vaultManager as {
              syncAllVaults?: () => unknown;
            };
            if (typeof manager.syncAllVaults === "function") {
              return manager.syncAllVaults();
            }
          });
        });
      },
      diskSyncIntervalMs
    );
  }
};
