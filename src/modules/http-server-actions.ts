import type HttpServer = require("./http-server");
import { staleTargetError } from "./http-server-approval";
import type {
  ActionData,
  HttpActionResponse,
  HttpVault,
} from "./http-server-contracts";

const projectExists = (vault: HttpVault, projectName: string): boolean => {
  try {
    return vault.getProjects().some((project) => project.name === projectName);
  } catch {
    return false;
  }
};

export const httpActionListProjects = (
  _safeData: ActionData,
  vault: HttpVault,
  _signal: AbortSignal | null
): HttpActionResponse => {
  let result: HttpActionResponse;
  {
    result = { data: vault.getProjects(), success: true };
    return result;
  }
};

export const httpActionListEnvironments = (
  safeData: ActionData,
  vault: HttpVault,
  _signal: AbortSignal | null
): HttpActionResponse => {
  let result: HttpActionResponse;
  {
    const { projectName } = safeData;
    if (
      typeof projectName !== "string" ||
      projectName.trim().length === 0 ||
      Object.hasOwn(safeData, "environmentName") ||
      Object.hasOwn(safeData, "environmentId")
    ) {
      result = {
        error:
          "A Project name is required and Environment selectors are not accepted for discovery",
        success: false,
      };
      return result;
    }
    result = { data: vault.getEnvironments(projectName), success: true };
    return result;
  }
};

export const httpActionListSecretKeys = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const captured = bridge._captureTarget(vault, safeData);
      const secrets = bridge._readSecrets(vault, captured);
      const keys = Object.keys(secrets);
      if (keys.length === 0) {
        result = { data: [], success: true };
      } else {
        const approvalResult = await bridge.requestBatchApproval(
          bridge._approvalRequest(captured, keys, "read"),
          signal
        );
        if (approvalResult.approved) {
          bridge._throwIfAborted(signal);
          bridge._assertFreshTarget(vault, captured, secrets);
          bridge._logCompletedRead(captured, keys);
          result = { data: keys, success: true };
        } else {
          const reason = approvalResult.reason || "User denied";
          result = { error: `Access denied: ${reason}`, success: false };
        }
      }
    }
    return result;
  }
};

export const httpActionGetAllSecrets = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const captured = bridge._captureTarget(vault, safeData);
      const secrets = bridge._readSecrets(vault, captured);
      const keys = Object.keys(secrets);
      if (keys.length === 0) {
        result = { data: {}, success: true };
      } else {
        const approvalResult = await bridge.requestBatchApproval(
          bridge._approvalRequest(captured, keys, "read"),
          signal
        );
        if (approvalResult.approved) {
          bridge._throwIfAborted(signal);
          // The pre-approval snapshot is only released when it still
          // matches the target exactly; a changed Environment is stale.
          bridge._assertFreshTarget(vault, captured, secrets);
          bridge._logCompletedRead(captured, keys);
          result = {
            data: bridge._readSecrets(vault, captured),
            success: true,
          };
        } else {
          const reason = approvalResult.reason || "User denied";
          result = { error: `Access denied: ${reason}`, success: false };
        }
      }
    }
    return result;
  }
};

export const httpActionGetBatchSecrets = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const rawKeys = Array.isArray(safeData.keys) ? safeData.keys : [];
      const keys = rawKeys.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0
      );
      const captured = bridge._captureTarget(vault, safeData);
      const approvedSnapshot = bridge._readSecrets(vault, captured);
      const before: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        before[key] = approvedSnapshot[key] ?? null;
      }
      const approvalResult = await bridge.requestBatchApproval(
        bridge._approvalRequest(captured, keys, "read"),
        signal
      );
      if (approvalResult.approved) {
        bridge._throwIfAborted(signal);
        bridge._assertFreshTarget(vault, captured, approvedSnapshot);
        bridge._logCompletedRead(captured, keys);
        const secrets: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
          const current = approvedSnapshot[key] ?? null;
          if (current !== null) {
            secrets[key] = current;
          }
        }
        result = { data: secrets, success: true };
      } else {
        const reason = approvalResult.reason || "User denied";
        result = { error: `Access denied: ${reason}`, success: false };
      }
    }
    return result;
  }
};

export const httpActionGetSecret = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const key = typeof safeData.key === "string" ? safeData.key : "";
      const captured = bridge._captureTarget(vault, safeData);
      const before = bridge._readSecret(vault, captured, key);
      const approvalResult = await bridge.requestBatchApproval(
        bridge._approvalRequest(captured, [key], "read"),
        signal
      );
      if (approvalResult.approved) {
        bridge._throwIfAborted(signal);
        bridge._assertFreshTarget(vault, captured);
        const value = bridge._readSecret(vault, captured, key);
        if (JSON.stringify(value) !== JSON.stringify(before)) {
          throw staleTargetError();
        }
        bridge._logCompletedRead(captured, [key]);
        result = { data: value, success: true };
      } else {
        const reason = approvalResult.reason || "User denied";
        result = { error: `Access denied: ${reason}`, success: false };
      }
    }
    return result;
  }
};

export const httpActionSetSecret = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const key = typeof safeData.key === "string" ? safeData.key : "";
      const captured = bridge._captureTarget(vault, safeData);
      const before = bridge._readSecrets(vault, captured)[key] ?? null;
      const approvalResult = await bridge.requestBatchApproval(
        bridge._approvalRequest(captured, [key], "write"),
        signal
      );
      if (approvalResult.approved) {
        bridge._throwIfAborted(signal);
        bridge._assertFreshTarget(vault, captured);
        if (
          JSON.stringify(bridge._readSecrets(vault, captured)[key] ?? null) !==
          JSON.stringify(before)
        ) {
          throw staleTargetError();
        }
        vault.setSecret(captured.target, key, safeData.value);
        await vault.saveNow();
        bridge.logger?.logAccess?.(
          "Secret written",
          captured.identity.projectName,
          [key],
          { ...bridge._logTarget(captured), outcome: "approved" }
        );
        result = { success: true };
      } else {
        const reason = approvalResult.reason || "User denied";
        result = { error: `Access denied: ${reason}`, success: false };
      }
    }
    return result;
  }
};

export const httpActionCreateProject = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const projectName =
        typeof safeData.projectName === "string"
          ? safeData.projectName.trim()
          : "";
      if (projectName) {
        const alreadyExists = projectExists(vault, projectName);
        if (alreadyExists) {
          result = { data: { created: false }, success: true };
        } else {
          // Project creation is a grouping operation and is never Environment-scoped.
          const vaultId = vault.getVaultId?.() || null;
          const vaultName =
            bridge.vaultManager
              ?.getVaultList?.()
              .find(
                (entry: { id: string; name: string }) => entry.id === vaultId
              )?.name ||
            (vaultId === "system" || vaultId === null ? "System" : "Vault");
          const approvalResult = await bridge.requestBatchApproval(
            {
              action: "write",
              environmentId: null,
              environmentName: null,
              keys: [],
              projectName,
              vaultId,
              vaultInstanceId: vault.getVaultInstanceId?.() || null,
              vaultName,
            },
            signal
          );
          if (approvalResult.approved) {
            bridge._throwIfAborted(signal);
            try {
              vault.createProject(projectName);
              await vault.saveNow();
              result = { data: { created: true }, success: true };
            } catch (error) {
              if (error && /already exists/u.test(error.message || "")) {
                result = { data: { created: false }, success: true };
              } else {
                throw error;
              }
            }
          } else {
            const reason = approvalResult.reason || "User denied";
            result = { error: `Access denied: ${reason}`, success: false };
          }
        }
      } else {
        result = { error: "projectName is required", success: false };
      }
    }
    return result;
  }
};

export const httpActionSetBatchSecrets = async (
  bridge: HttpServer,
  safeData: ActionData,
  vault: HttpVault,
  signal: AbortSignal | null
): Promise<HttpActionResponse> => {
  let result: HttpActionResponse;
  {
    {
      const projectName =
        typeof safeData.projectName === "string"
          ? safeData.projectName.trim()
          : "";
      const rawSecrets = safeData.secrets;
      const entries =
        rawSecrets &&
        typeof rawSecrets === "object" &&
        !Array.isArray(rawSecrets)
          ? (Object.entries(rawSecrets) as [string, unknown][])
          : [];
      const invalid = entries.some(
        ([key, value]) =>
          typeof key !== "string" ||
          key.trim() === "" ||
          typeof value !== "string"
      );
      if (!projectName) {
        result = { error: "projectName is required", success: false };
      } else if (entries.length === 0 || invalid) {
        result = {
          error: "secrets must be a non-empty object of string key/value pairs",
          success: false,
        };
      } else {
        const exists = projectExists(vault, projectName);
        if (exists) {
          const keys = entries.map(([key]) => key);
          const captured = bridge._captureTarget(vault, safeData);
          const approvedSnapshot = bridge._readSecrets(vault, captured);
          const before: Record<string, unknown> = Object.fromEntries(
            keys.map((key) => [key, approvedSnapshot[key] ?? null])
          );
          const approvalResult = await bridge.requestBatchApproval(
            bridge._approvalRequest(captured, keys, "write"),
            signal
          );
          if (approvalResult.approved) {
            bridge._throwIfAborted(signal);
            bridge._assertFreshTarget(vault, captured);
            for (const key of keys) {
              if (
                JSON.stringify(
                  bridge._readSecrets(vault, captured)[key] ?? null
                ) !== JSON.stringify(before[key])
              ) {
                throw staleTargetError();
              }
            }
            for (const [key, value] of entries) {
              vault.setSecret(captured.target, key, value);
            }
            await vault.saveNow();
            bridge.logger?.logAccess?.(
              "Secrets written",
              captured.identity.projectName,
              keys,
              { ...bridge._logTarget(captured), outcome: "approved" }
            );
            result = { data: { count: entries.length }, success: true };
          } else {
            const reason = approvalResult.reason || "User denied";
            result = { error: `Access denied: ${reason}`, success: false };
          }
        } else {
          result = {
            error: `Project '${projectName}' does not exist. Call create_project first.`,
            success: false,
          };
        }
      }
    }
    return result;
  }
};
