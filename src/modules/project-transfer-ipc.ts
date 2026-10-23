import fs from "node:fs";
import os from "node:os";

import type { BridgeFailure } from "../project/bridge";
import {
  captureApprovalTarget,
  sameApprovalTarget,
  sessionErrorResponse,
  validEnvironmentTarget,
} from "./project-secrets-ipc";
import type {
  ApprovalTarget,
  SecretVaultLike,
  VaultSessionLike,
} from "./project-secrets-ipc";

export interface ProjectBackupIdentity {
  sessionTransitionId: number | string | undefined;
  vaultId: string | null;
  vaultInstanceId: string | null;
  projectName: string;
  projectIncarnation: string | null;
  defaultEnvironmentId: string;
  fingerprint: string;
}

interface CapturedProjectBackup {
  identity: ProjectBackupIdentity;
  encryptedBackup: Buffer;
}

const EXPORT_MODES = ["example", "references", "raw"] as const;
type ExportMode = (typeof EXPORT_MODES)[number];
const isExportMode = (value: unknown): value is ExportMode =>
  EXPORT_MODES.some((mode) => mode === value);

const TARGET_REQUIRED_FAILURE: BridgeFailure = Object.freeze({
  error: "A Project and Environment are required",
  success: false,
});

const PROJECT_REQUIRED_FAILURE: BridgeFailure = Object.freeze({
  error: "A Project is required",
  success: false,
});

export interface TransferVaultLike extends SecretVaultLike {
  captureProjectBackupSnapshot: (projectName: string) => {
    defaultEnvironmentId: string;
    encryptedBackup: Buffer;
    fingerprint: string;
    projectIncarnation?: string | null;
    vaultId?: string | null;
    vaultInstanceId?: string | null;
  };
  getSecrets: (target: unknown) => Record<string, { value?: unknown }>;
  verifyPassword: (password: string) => boolean;
}

export interface TransferSessionLike extends Omit<
  VaultSessionLike,
  "withActiveSession"
> {
  withActiveSession: <T>(
    operation: (context: {
      activeVault: TransferVaultLike;
      signal?: AbortSignal;
    }) => Promise<T> | T
  ) => Promise<T>;
}

export const captureProjectBackupIdentity = (
  activeVault: TransferVaultLike,
  projectName: string,
  session: VaultSessionLike
): CapturedProjectBackup => {
  const sessionSnapshot = session.snapshot();
  const snapshot = activeVault.captureProjectBackupSnapshot(projectName);
  return {
    encryptedBackup: snapshot.encryptedBackup,
    identity: {
      defaultEnvironmentId: snapshot.defaultEnvironmentId,
      fingerprint: snapshot.fingerprint,
      projectIncarnation: snapshot.projectIncarnation ?? null,
      projectName,
      sessionTransitionId: sessionSnapshot.transitionId,
      vaultId: snapshot.vaultId ?? null,
      vaultInstanceId: snapshot.vaultInstanceId ?? null,
    },
  };
};

export const sameProjectBackupIdentity = (
  left: ProjectBackupIdentity,
  right: ProjectBackupIdentity
): boolean =>
  left.sessionTransitionId === right.sessionTransitionId &&
  left.vaultId === right.vaultId &&
  left.vaultInstanceId === right.vaultInstanceId &&
  left.projectName === right.projectName &&
  left.projectIncarnation === right.projectIncarnation &&
  left.defaultEnvironmentId === right.defaultEnvironmentId &&
  left.fingerprint === right.fingerprint;

/** Canonical form so data drift during a native picker is detected, not exported. */
const canonicalValue = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  // SAFETY: The branch above excludes primitives and arrays; values remain unknown for recursive serialization.
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    // eslint-disable-next-line unicorn/no-array-sort
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
    .join(",")}}`;
};

const encodeEnvValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '""';
  }
  const stringValue = String(value);
  if (stringValue.length === 0) {
    return '""';
  }
  const escaped = stringValue
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
  return `"${escaped}"`;
};

export const writeExportFile = (
  filePath: string,
  content: string | Buffer
): void => {
  fs.writeFileSync(filePath, content);
  try {
    if (os.platform() !== "win32") {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // Best-effort desktop cleanup must not replace the primary action result.
  }
};

export interface ProjectTransferIpcDependencies {
  dialog: {
    showSaveDialog: (
      window: unknown,
      options: unknown
    ) => Promise<{ canceled: boolean; filePath?: string }>;
  };
  getWindow: () => unknown;
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
    logAccess: (
      summary: string,
      projectName: string,
      keys: string[],
      metadata: Record<string, unknown>
    ) => void;
    logApp: (message: string) => void;
  };
  session: TransferSessionLike;
  vaultManager?: {
    getVaultList?: () => { id: string; name: string }[];
  };
}

export const registerProjectTransferIpc = ({
  dialog,
  getWindow,
  ipcMain,
  logger,
  session,
  vaultManager,
}: ProjectTransferIpcDependencies): void => {
  ipcMain.handle(
    "secrets:export",
    async (_event, target, mode = "raw", options = {}) => {
      if (!validEnvironmentTarget(target)) {
        return TARGET_REQUIRED_FAILURE;
      }
      if (!isExportMode(mode)) {
        return {
          code: "EXPORT_MODE_UNSUPPORTED",
          error: `Unsupported export mode. Use one of: ${EXPORT_MODES.join(", ")}.`,
          success: false,
        };
      }
      const exportMode = mode;
      const password =
        options &&
        typeof options === "object" &&
        "password" in options &&
        typeof options.password === "string"
          ? options.password
          : "";

      let admission: {
        secrets: Record<string, { value?: unknown }>;
        secretsSnapshot: string;
        target: ApprovalTarget;
      };
      try {
        admission = await session.withActiveSession(({ activeVault }) => {
          const secrets = activeVault.getSecrets(target);
          return {
            secrets,
            secretsSnapshot: canonicalValue(secrets),
            target: captureApprovalTarget(
              activeVault,
              target,
              session,
              vaultManager
            ),
          };
        });
      } catch (error) {
        return sessionErrorResponse(error);
      }

      const captured = admission.target;
      const safeProject = encodeURIComponent(target.projectName);
      const safeEnvironment = encodeURIComponent(captured.environmentName);
      const suffix = `-${safeEnvironment}`;
      const dialogs: Record<
        ExportMode,
        {
          defaultPath: string;
          filters: { extensions: string[]; name: string }[];
        }
      > = {
        example: {
          defaultPath: `${safeProject}${suffix}.env.example`,
          filters: [
            { extensions: ["example", "env"], name: "Env Example Files" },
            { extensions: ["*"], name: "All Files" },
          ],
        },
        raw: {
          defaultPath: `${safeProject}${suffix}.env`,
          filters: [
            { extensions: ["env"], name: "Environment Files" },
            { extensions: ["*"], name: "All Files" },
          ],
        },
        references: {
          defaultPath: `${safeProject}${suffix}.env.keys`,
          filters: [
            { extensions: ["keys", "env"], name: "KeyHarbor Reference Files" },
            { extensions: ["*"], name: "All Files" },
          ],
        },
      };

      const result = await dialog.showSaveDialog(
        getWindow(),
        dialogs[exportMode]
      );
      if (result.canceled || !result.filePath) {
        return { cancelled: true, success: false };
      }
      const exportFilePath = result.filePath;

      try {
        return await session.withActiveSession(({ activeVault }) => {
          if (
            !sameApprovalTarget(
              captured,
              captureApprovalTarget(activeVault, target, session, vaultManager)
            ) ||
            canonicalValue(activeVault.getSecrets(target)) !==
              admission.secretsSnapshot
          ) {
            return {
              code: "ENVIRONMENT_TARGET_STALE",
              error:
                "Secrets changed while choosing a file. Review and export again.",
              success: false,
            };
          }
          if (exportMode === "raw" && !activeVault.verifyPassword(password)) {
            return { error: "Incorrect password", success: false };
          }
          const { secrets } = admission;
          const lines: string[] = [];
          for (const [key, secret] of Object.entries(secrets)) {
            if (typeof key !== "string" || /[\r\n\0=]/u.test(key)) {
              return {
                error: `Invalid key for .env export: ${String(key)}`,
                success: false,
              };
            }
            if (exportMode === "example") {
              lines.push(`${key}=`);
            } else if (exportMode === "references") {
              lines.push(
                `${key}=keyharbor://${safeProject}/${encodeURIComponent(key)}?environment=${safeEnvironment}`
              );
            } else {
              lines.push(`${key}=${encodeEnvValue(secret?.value)}`);
            }
          }
          writeExportFile(exportFilePath, lines.join("\n"));
          if (exportMode === "raw") {
            logger?.logAccess(
              "Raw values exported",
              target.projectName,
              Object.keys(secrets),
              { ...captured, action: "export", outcome: "approved" }
            );
          } else {
            logger?.logApp(
              `Environment export completed (${exportMode}): ${target.projectName}/${captured.environmentName}`
            );
          }
          return { path: result.filePath, success: true };
        });
      } catch (error) {
        return sessionErrorResponse(error);
      }
    }
  );

  ipcMain.handle("projects:backup", async (_event, projectName: unknown) => {
    if (typeof projectName !== "string" || projectName.trim().length === 0) {
      return PROJECT_REQUIRED_FAILURE;
    }

    let admission: { identity: ProjectBackupIdentity; encryptedBackup: Buffer };
    try {
      admission = await session.withActiveSession(({ activeVault }) =>
        captureProjectBackupIdentity(activeVault, projectName, session)
      );
    } catch (error) {
      return sessionErrorResponse(error);
    }

    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: `${encodeURIComponent(projectName)}.lkvb`,
      filters: [{ extensions: ["lkvb"], name: "KeyHarbor Backup" }],
    });
    if (result.canceled || !result.filePath) {
      return { cancelled: true, success: false };
    }
    const backupFilePath = result.filePath;
    try {
      return await session.withActiveSession(({ activeVault }) => {
        const current = captureProjectBackupIdentity(
          activeVault,
          projectName,
          session
        );
        if (!sameProjectBackupIdentity(admission.identity, current.identity)) {
          return {
            code: "ENVIRONMENT_TARGET_STALE",
            error:
              "The Project or Vault changed while choosing a file. Start the backup again.",
            success: false,
          };
        }
        writeExportFile(backupFilePath, admission.encryptedBackup);
        logger?.logApp(
          `Encrypted Project backup exported: ${projectName} (all Environments)`
        );
        return { path: result.filePath, success: true };
      });
    } catch (error) {
      return sessionErrorResponse(error);
    }
  });
};
