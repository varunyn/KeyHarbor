import type HttpServer = require("./http-server");
import type {
  ActionData,
  HttpActionResponse,
  HttpVault,
  HttpSessionContext,
} from "./http-server-contracts";

const { version: APP_VERSION } = require("../../package.json");

const ENVIRONMENT_PROTOCOL_VERSION = 1;
const SENSITIVE_ACTIONS = new Set<string>([
  "listProjects",
  "listEnvironments",
  "listSecretKeys",
  "getAllSecrets",
  "getBatchSecrets",
  "getSecret",
  "setSecret",
  "createProject",
  "setBatchSecrets",
  "listVaults",
  "createAgentSession",
  "closeAgentSession",
]);

export const httpGetVault = async (
  sessionContext: HttpSessionContext,
  vaultName: string | null
): Promise<HttpVault | null> => {
  const vaults = sessionContext?.vaults;
  let vault: HttpVault | null = null;
  if (typeof vaults?.getByName === "function") {
    vault = await vaults.getByName(vaultName || null);
  } else if (!vaultName) {
    vault = sessionContext?.activeVault ?? null;
  }
  if (!vault || vault.isLocked) {
    return null;
  }
  return vault;
};

export const httpHandleAction = async (
  bridge: HttpServer,
  action: Parameters<HttpServer["handleAction"]>[0],
  data: Parameters<HttpServer["handleAction"]>[1]
): Promise<HttpActionResponse> => {
  if (action === "status") {
    return {
      data: {
        environmentProtocolVersion: ENVIRONMENT_PROTOCOL_VERSION,
        isUnlocked: bridge._getSessionState() === "active",
        version: APP_VERSION,
      },
      success: true,
    };
  }
  if (typeof action !== "string" || !SENSITIVE_ACTIONS.has(action)) {
    return { error: "Unknown action", success: false };
  }
  try {
    // SAFETY: The guard admits only non-array objects; action handlers validate each unknown field.
    const safeData =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as ActionData)
        : {};
    if (!bridge.vaultSession) {
      const error = new Error("Vault is locked");
      error.code = "VAULT_SESSION_LOCKED";
      throw error;
    }
    if (action === "createAgentSession" || action === "closeAgentSession") {
      if (!bridge.agentProxy) {
        return { error: "Agent proxy is unavailable", success: false };
      }
      if (action === "createAgentSession") {
        return {
          data: await bridge.agentProxy.createSession(safeData),
          success: true,
        };
      }
      if (typeof safeData.sessionId !== "string") {
        return { error: "An agent session ID is required", success: false };
      }
      bridge.agentProxy.close(safeData.sessionId);
      return { success: true };
    }
    return await bridge.vaultSession.withActiveSession(
      async (sessionContext: HttpSessionContext) => {
        const signal = sessionContext?.signal ?? null;
        bridge._throwIfAborted(signal);
        if (action === "listVaults") {
          const list = sessionContext?.vaults?.list;
          if (typeof list === "function") {
            return {
              data: await list.call(sessionContext.vaults),
              success: true,
            };
          }
          if (typeof bridge.vaultManager?.getVaultList === "function") {
            return { data: bridge.vaultManager.getVaultList(), success: true };
          }
          throw new Error("Vault list is unavailable");
        }
        const vault = await bridge._getVault(
          sessionContext,
          typeof safeData.vaultName === "string" ? safeData.vaultName : null
        );
        bridge._throwIfAborted(signal);
        if (!vault) {
          return { error: "Vault is locked", success: false };
        }
        return await bridge._handleVaultAction(action, safeData, vault, signal);
      }
    );
  } catch (error) {
    return bridge._publicError(error);
  }
};

export const httpGetSessionState = (bridge: HttpServer) => {
  try {
    return bridge.vaultSession?.snapshot()?.state || "locked";
  } catch {
    return "locked";
  }
};
