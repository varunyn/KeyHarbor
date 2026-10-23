import type {
  BridgeFailure,
  BridgeResult,
  DataResult,
  EnvironmentTarget,
} from "../project/bridge";
import { sessionErrorResponse } from "./project-bridge-support";

export interface ApprovalTarget {
  vaultId: string | null;
  vaultName: string;
  vaultInstanceId: string | null;
  sessionTransitionId: number | string | undefined;
  projectName: string;
  projectIncarnation: string | null;
  environmentId: string;
  environmentName: string;
  environmentIncarnation: string | null;
}

export interface SecretVaultLike {
  createProject: (name: unknown) => unknown;
  deleteProject: (name: unknown) => unknown;
  deleteSecret: (target: EnvironmentTarget, key: unknown) => unknown;
  getEnvironmentTargetIdentity: (target: EnvironmentTarget) => {
    environmentId: string;
    environmentIncarnation: string | null;
    environmentName: string;
    projectIncarnation: string | null;
    projectName: string;
  };
  getFavorites: () => unknown;
  getProjects: () => unknown;
  getSecret: (target: EnvironmentTarget, key: unknown) => unknown;
  getSecretHistory: (target: EnvironmentTarget, key: unknown) => unknown;
  getSecrets: (target: EnvironmentTarget) => unknown;
  getStatistics: () => Record<string, unknown>;
  getVaultId?: () => string | null;
  getVaultInstanceId: () => string | null;
  renameSecret: (
    target: EnvironmentTarget,
    fromKey: unknown,
    toKey: unknown
  ) => unknown;
  restoreSecretVersion: (
    target: EnvironmentTarget,
    key: unknown,
    versionIndex: unknown
  ) => unknown;
  setSecret: (
    target: EnvironmentTarget,
    key: unknown,
    value: unknown,
    expiresAt?: unknown,
    meta?: unknown
  ) => unknown;
  toggleProjectFavorite: (projectName: unknown) => Promise<boolean> | boolean;
  toggleSecretFavorite: (
    target: EnvironmentTarget,
    secretKey: unknown
  ) => Promise<boolean> | boolean;
}

export interface VaultSessionLike {
  snapshot: () => {
    activeVaultId?: string | null;
    state: string;
    transitionId?: number | string;
  };
  vaultManager?: {
    getVaultList?: () => { id: string; name: string }[];
  };
  withActiveSession: <T>(
    operation: (context: {
      activeVault: SecretVaultLike;
      signal?: AbortSignal;
    }) => Promise<T> | T
  ) => Promise<T>;
}

export interface ProjectSecretsIpcDependencies {
  ipcMain: {
    handle: (
      channel: string,
      listener: (
        event: unknown,
        ...args: unknown[]
      ) => Promise<unknown> | unknown
    ) => void;
  };
  logger?: {
    countCompletedAccess: (
      since: number,
      vaultInstanceId?: string | null
    ) => number;
    logAccess: (
      summary: string,
      projectName: string,
      keys: string[],
      metadata: Record<string, unknown>
    ) => void;
  };
  session: VaultSessionLike;
  showApprovalDialog: (
    request: unknown,
    signal?: AbortSignal | null
  ) => Promise<{ approved: boolean; reason?: string }>;
  vaultManager?: {
    getVaultList?: () => { id: string; name: string }[];
  };
}

const TARGET_REQUIRED_FAILURE: BridgeFailure = Object.freeze({
  error: "A Project and Environment are required",
  success: false,
});

/** Desktop Secret operations require an explicit Project and Environment ID. */
export const validEnvironmentTarget = (
  target: unknown
): target is EnvironmentTarget => {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }
  const candidate = target;
  return (
    Object.keys(candidate).length === 2 &&
    Object.hasOwn(candidate, "projectName") &&
    Object.hasOwn(candidate, "environmentId") &&
    "projectName" in candidate &&
    typeof candidate.projectName === "string" &&
    candidate.projectName.trim().length > 0 &&
    "environmentId" in candidate &&
    typeof candidate.environmentId === "string" &&
    candidate.environmentId.length > 0
  );
};

export const captureApprovalTarget = (
  activeVault: SecretVaultLike,
  target: EnvironmentTarget,
  session: VaultSessionLike,
  vaultManager?: { getVaultList?: () => { id: string; name: string }[] }
): ApprovalTarget => {
  const sessionSnapshot = session.snapshot();
  const identity = activeVault.getEnvironmentTargetIdentity(target);
  const vaultId =
    activeVault.getVaultId?.() || sessionSnapshot.activeVaultId || "system";
  const manager = vaultManager || session.vaultManager;
  const vaultName =
    manager?.getVaultList?.()?.find((entry) => entry.id === vaultId)?.name ||
    "System";
  return {
    environmentId: identity.environmentId,
    environmentIncarnation: identity.environmentIncarnation,
    environmentName: identity.environmentName,
    projectIncarnation: identity.projectIncarnation,
    projectName: identity.projectName,
    sessionTransitionId: sessionSnapshot.transitionId,
    vaultId,
    vaultInstanceId: activeVault.getVaultInstanceId(),
    vaultName,
  };
};

export const sameApprovalTarget = (
  left: ApprovalTarget,
  right: ApprovalTarget
): boolean =>
  left.vaultId === right.vaultId &&
  left.vaultName === right.vaultName &&
  left.vaultInstanceId === right.vaultInstanceId &&
  left.sessionTransitionId === right.sessionTransitionId &&
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.environmentId === right.environmentId &&
  left.environmentName === right.environmentName &&
  left.environmentIncarnation === right.environmentIncarnation;

const withTarget = <T>(
  target: unknown,
  operation: (validTarget: EnvironmentTarget) => Promise<T> | T
): Promise<T | BridgeFailure> => {
  if (validEnvironmentTarget(target)) {
    return Promise.resolve(operation(target));
  }
  return Promise.resolve(TARGET_REQUIRED_FAILURE);
};

export const registerProjectSecretsIpc = ({
  ipcMain,
  logger,
  session,
  showApprovalDialog,
  vaultManager,
}: ProjectSecretsIpcDependencies): void => {
  const withActiveVault = async (
    operation: (
      activeVault: SecretVaultLike,
      signal?: AbortSignal
    ) => Promise<unknown> | unknown
  ): Promise<BridgeResult> => {
    try {
      await session.withActiveSession(({ activeVault, signal }) =>
        operation(activeVault, signal)
      );
      return { success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  };

  const withActiveVaultData = async <T>(
    operation: (
      activeVault: SecretVaultLike,
      signal?: AbortSignal
    ) => Promise<T> | T
  ): Promise<DataResult<T>> => {
    try {
      const data = await session.withActiveSession(({ activeVault, signal }) =>
        operation(activeVault, signal)
      );
      return { data, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  };

  ipcMain.handle("projects:get", () =>
    withActiveVaultData((activeVault) => activeVault.getProjects())
  );

  ipcMain.handle("project:create", (_event, name: unknown) =>
    withActiveVault((activeVault) => activeVault.createProject(name))
  );

  ipcMain.handle("project:delete", (_event, name: unknown) =>
    withActiveVault((activeVault) => activeVault.deleteProject(name))
  );

  ipcMain.handle("secrets:get", (_event, target: unknown) =>
    withTarget(target, (validTarget) =>
      withActiveVaultData((activeVault) => activeVault.getSecrets(validTarget))
    )
  );

  ipcMain.handle(
    "secret:set",
    (_event, target, key, value, expiresAt = null, meta = {}) =>
      withTarget(target, (validTarget) =>
        withActiveVault((activeVault) =>
          activeVault.setSecret(validTarget, key, value, expiresAt, meta)
        )
      )
  );

  ipcMain.handle(
    "secret:update",
    (_event, target, fromKey, toKey, value, expiresAt = null, meta = {}) =>
      withTarget(target, (validTarget) =>
        withActiveVault((activeVault) => {
          if (typeof fromKey !== "string" || typeof toKey !== "string") {
            throw new TypeError("Invalid secret key");
          }
          if (!fromKey.trim() || !toKey.trim()) {
            throw new Error("Secret key cannot be empty");
          }
          const didRename = fromKey !== toKey;
          let renameSucceeded = false;
          try {
            if (didRename) {
              activeVault.renameSecret(validTarget, fromKey, toKey);
              renameSucceeded = true;
            }
            activeVault.setSecret(validTarget, toKey, value, expiresAt, meta);
          } catch (error) {
            if (renameSucceeded) {
              try {
                activeVault.renameSecret(validTarget, toKey, fromKey);
              } catch {
                // Best-effort desktop cleanup must not replace the primary action result.
              }
            }
            throw error;
          }
        })
      )
  );

  ipcMain.handle("secret:rename", (_event, target, fromKey, toKey) =>
    withTarget(target, (validTarget) =>
      withActiveVault((activeVault) =>
        activeVault.renameSecret(validTarget, fromKey, toKey)
      )
    )
  );

  ipcMain.handle("secret:delete", (_event, target, key) =>
    withTarget(target, (validTarget) =>
      withActiveVault((activeVault) =>
        activeVault.deleteSecret(validTarget, key)
      )
    )
  );

  ipcMain.handle("favorite:toggleProject", async (_event, projectName) => {
    try {
      const added = await session.withActiveSession(({ activeVault }) =>
        activeVault.toggleProjectFavorite(projectName)
      );
      return { added, success: true };
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });

  ipcMain.handle("favorite:toggleSecret", (_event, target, secretKey) =>
    withTarget(target, async (validTarget) => {
      try {
        const added = await session.withActiveSession(({ activeVault }) =>
          activeVault.toggleSecretFavorite(validTarget, secretKey)
        );
        return { added, success: true };
      } catch (error) {
        return sessionErrorResponse(error);
      }
    })
  );

  ipcMain.handle("favorites:get", () =>
    withActiveVaultData((activeVault) => activeVault.getFavorites())
  );

  ipcMain.handle("statistics:get", () =>
    withActiveVaultData((activeVault) => {
      const stats = activeVault.getStatistics();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentAccessCount = logger
        ? logger.countCompletedAccess(
            oneDayAgo.getTime(),
            activeVault.getVaultInstanceId()
          )
        : 0;
      return { ...stats, recentAccessCount };
    })
  );

  ipcMain.handle("secret:get", (_event, target, key) =>
    withTarget(target, async (validTarget) => {
      try {
        return await session.withActiveSession(
          async ({ activeVault, signal }) => {
            const captured = captureApprovalTarget(
              activeVault,
              validTarget,
              session,
              vaultManager
            );
            const secret = activeVault.getSecret(validTarget, key);
            const keyName = typeof key === "string" ? key : String(key);
            const result = await showApprovalDialog(
              { ...captured, action: "read", keys: [keyName] },
              signal
            );
            if (!result.approved) {
              return { error: "Access denied", success: false };
            }
            if (
              !sameApprovalTarget(
                captured,
                captureApprovalTarget(
                  activeVault,
                  validTarget,
                  session,
                  vaultManager
                )
              ) ||
              JSON.stringify(secret) !==
                JSON.stringify(activeVault.getSecret(validTarget, key))
            ) {
              return {
                code: "ENVIRONMENT_TARGET_STALE",
                error: "Target changed. Request approval again.",
                success: false,
              };
            }
            logger?.logAccess("Secret read", captured.projectName, [keyName], {
              action: "read",
              environmentId: captured.environmentId,
              environmentName: captured.environmentName,
              outcome: "approved",
              projectName: captured.projectName,
              vaultId: captured.vaultId,
              vaultInstanceId: captured.vaultInstanceId,
            });
            return { data: secret, success: true };
          }
        );
      } catch (error) {
        return sessionErrorResponse(error);
      }
    })
  );

  ipcMain.handle("secret:getHistory", (_event, target, key) =>
    withTarget(target, (validTarget) =>
      withActiveVaultData((activeVault) =>
        activeVault.getSecretHistory(validTarget, key)
      )
    )
  );

  ipcMain.handle("secret:restoreVersion", (_event, target, key, versionIndex) =>
    withTarget(target, (validTarget) =>
      withActiveVault((activeVault) =>
        activeVault.restoreSecretVersion(validTarget, key, versionIndex)
      )
    )
  );
};
