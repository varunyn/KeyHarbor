import type { IncomingMessage, Server, ServerResponse } from "node:http";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getAppDataPath } = require("./app-data-path");
const { version: APP_VERSION } = require("../../package.json");

const hasOwn = (value: object, key: string): boolean =>
  Object.hasOwn(value, key);
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
const staleTargetError = (): Error => {
  const error = new Error("Target changed. Request approval again.");
  error.code = "ENVIRONMENT_TARGET_STALE";
  return error;
};
const ignoreAbort = () => {
  // Assigned before awaiting the abortable request.
};
const projectExists = (vault: HttpVault, projectName: string): boolean => {
  try {
    return vault.getProjects().some((project) => project.name === projectName);
  } catch {
    return false;
  }
};
/** Environment protocol version advertised to clients; 1 is the first Environment-aware release. */
const ENVIRONMENT_PROTOCOL_VERSION = 1;
const SERVER_INFO_PATH = path.join(getAppDataPath(), "server-info.json");
const SESSION_STATE_ERRORS = new Map<string, string>([
  ["VAULT_SESSION_LOCKED", "Vault is locked"],
  ["VAULT_SESSION_OPENING", "Vault is opening"],
  ["VAULT_SESSION_RECOVERING", "Vault recovery is required"],
  ["VAULT_SESSION_CLOSING", "Vault is closing"],
  ["VAULT_SESSION_DESTROYING", "Vault is being deleted"],
]);
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
]);
/** External selector: a Project plus an optional Environment name, or no Environment at all. */
type ActionData = Record<string, unknown>;
type EnvironmentTarget = Readonly<{
  projectName: string;
  environmentId: string;
}>;
interface CapturedTarget {
  target: EnvironmentTarget;
  identity: {
    projectName: string;
    environmentId: string;
    environmentName: string;
    projectIncarnation: string | null;
    environmentIncarnation: string | null;
  };
  vaultId: string | null;
  vaultName: string;
  vaultInstanceId: string | null;
}
type ApprovalActionShape = "read" | "write";
interface ApprovalRequestShape {
  vaultId: string | null;
  vaultName: string;
  vaultInstanceId: string | null;
  projectName: string;
  /** Null only for Project grouping operations, which are never Environment-scoped. */
  environmentId: string | null;
  environmentName: string | null;
  keys: string[];
  action: ApprovalActionShape;
}
interface ApprovalDecisionShape {
  approved: boolean;
  reason?: string;
}
type ApprovalCallbackShape = (
  request: ApprovalRequestShape,
  signal: AbortSignal | null
) => Promise<ApprovalDecisionShape> | ApprovalDecisionShape;
type ActionResponseShape =
  | {
      success: true;
      data?: unknown;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };
interface HttpVault {
  isLocked: boolean;
  getProjects: () => {
    name: string;
  }[];
  getEnvironments: (name: string) => unknown;
  resolveEnvironmentTarget: (selector: {
    projectName: string;
    environmentName?: string;
    environmentId?: string;
  }) => EnvironmentTarget;
  getEnvironmentTargetIdentity: (
    target: EnvironmentTarget
  ) => CapturedTarget["identity"];
  getVaultId?: () => string | null;
  getVaultInstanceId?: () => string | null;
  getSecrets: (target: EnvironmentTarget) => Record<string, unknown>;
  getSecret: (target: EnvironmentTarget, key: string) => unknown;
  setSecret: (
    target: EnvironmentTarget,
    key: string,
    value: unknown
  ) => unknown;
  createProject: (name: string) => unknown;
  saveNow: () => Promise<unknown>;
}
interface HttpManager {
  getVaultByName?: (
    name: string
  ) => HttpVault | null | Promise<HttpVault | null>;
  getVaultList?: () => {
    id: string;
    name: string;
  }[];
  vaults?: Map<string, HttpVault>;
}
interface HttpLogger {
  logAccess?: (
    message: string,
    project: string,
    keys: string[],
    target: Record<string, unknown>
  ) => unknown;
}
interface HttpSessionContext {
  activeVault?: HttpVault | null;
  signal?: AbortSignal | null;
  vaults?: {
    getByName?: (
      name: string | null
    ) => HttpVault | null | Promise<HttpVault | null>;
    lookup?: (selector: {
      name: string | null;
    }) => HttpVault | null | Promise<HttpVault | null>;
    list?: () => unknown | Promise<unknown>;
  };
}
interface HttpSession {
  snapshot: () => {
    state: string;
  };
  withActiveSession: <T>(
    operation: (context: HttpSessionContext) => T | Promise<T>
  ) => Promise<T>;
}
// This constructor intentionally merges with the exported type namespace.
// eslint-disable-next-line no-redeclare
class HttpServer {
  vaultManager: HttpManager | null;
  logger: HttpLogger | null;
  vaultSession: HttpSession | null;
  server: Server | null;
  port: number;
  host: string;
  authToken: string;
  approvalCallback: ApprovalCallbackShape | null;
  constructor(
    vaultManager: HttpManager | null,
    logger: HttpLogger | null,
    vaultSession: HttpSession | null = null
  ) {
    // Kept during migration because main.js still constructs the server with
    // (vaultManager, logger). Admission never derives from this reference.
    this.vaultManager = vaultManager;
    this.logger = logger;
    this.vaultSession = null;
    this.server = null;
    this.port = 0;
    this.host = "localhost";
    this.authToken = this.generateAuthToken();
    this.approvalCallback = null;
    if (vaultSession) {
      this.bindVaultSession(vaultSession);
    }
  }
  bindVaultSession(vaultSession: HttpSession | null) {
    if (
      !vaultSession ||
      typeof vaultSession.withActiveSession !== "function" ||
      typeof vaultSession.snapshot !== "function"
    ) {
      throw new TypeError(
        "VaultSession must provide withActiveSession() and snapshot()"
      );
    }
    this.vaultSession = vaultSession;
    return this;
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  generateAuthToken() {
    return crypto.randomBytes(32).toString("hex");
  }
  // Preserve asynchronous rejection when constructing or binding the server fails.
  // eslint-disable-next-line require-await
  async start() {
    // Adapt the Node server listening/error events into the public Promise API.
    // eslint-disable-next-line promise/avoid-new
    return new Promise<{
      authToken: string;
      host: string;
      port: number;
    }>((resolve, reject) => {
      const server = http.createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          this.handleRequest(req, res);
        }
      );
      this.server = server;
      server.listen(0, this.host, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("HTTP server has no bound TCP address"));
          return;
        }
        this.port = address.port;
        try {
          fs.mkdirSync(path.dirname(SERVER_INFO_PATH), { recursive: true });
        } catch {
          // Discovery directory creation is best effort; the write below reports any failure.
        }
        try {
          fs.writeFileSync(
            SERVER_INFO_PATH,
            JSON.stringify({
              authToken: this.authToken,
              host: this.host,
              pid: process.pid,
              port: this.port,
            })
          );
          try {
            fs.chmodSync(SERVER_INFO_PATH, 0o600);
          } catch (error) {
            console.error(
              "Failed to set server-info.json permissions:",
              error.message
            );
          }
        } catch (error) {
          console.error("Failed to write server-info.json:", error.message);
        }
        resolve({
          authToken: this.authToken,
          host: this.host,
          port: this.port,
        });
      });
      server.on("error", (error: Error) => {
        reject(error);
      });
    });
  }
  // Preserve the Promise-returning shutdown API, including synchronous failures.
  // eslint-disable-next-line require-await
  async stop(): Promise<void> {
    const { server } = this;
    if (server) {
      // Node closes the listening socket through its completion callback.
      // eslint-disable-next-line promise/avoid-new
      return new Promise<void>((resolve) => {
        server.close(() => {
          try {
            if (fs.existsSync(SERVER_INFO_PATH)) {
              fs.unlinkSync(SERVER_INFO_PATH);
            }
          } catch {
            // Discovery file cleanup is best effort; finish closing the server.
          }
          this.server = null;
          this.authToken = "";
          this.port = 0;
          resolve();
        });
      });
    }
  }
  authenticateRequest(req: IncomingMessage, res: ServerResponse) {
    const { authorization: authHeader } = req.headers;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Authorization required", success: false })
      );
      return false;
    }
    const token = authHeader.slice(7);
    const expected = Buffer.from(this.authToken || "", "utf-8");
    const received = Buffer.from(token, "utf-8");
    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid token", success: false }));
      return false;
    }
    return true;
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  setCorsHeaders(res: ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
  }
  async handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      this.setCorsHeaders(res);
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Method not allowed", success: false })
        );
        return;
      }
      if (!this.authenticateRequest(req, res)) {
        return;
      }
      const body = await this.parseRequestBody(req);
      const action =
        body && typeof body === "object"
          ? (body as Record<string, unknown>).action
          : undefined;
      const data =
        body && typeof body === "object"
          ? (body as Record<string, unknown>).data
          : undefined;
      const result = await this.handleAction(action, data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      const statusCode = error?.message === "Request too large" ? 413 : 500;
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error.message,
          success: false,
        })
      );
    }
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  parseRequestBody(req: IncomingMessage) {
    // Request body completion/error events must settle one bounded read.
    // eslint-disable-next-line promise/avoid-new
    return new Promise<unknown>((resolve, reject) => {
      let body = "";
      let totalLength = 0;
      // Bound request payloads to 1 MiB.
      const MAX_BODY_SIZE = 1024 * 1024;
      req.on("data", (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error("Request too large"));
          return;
        }
        body += chunk.toString("utf-8");
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }
  async _getVault(
    sessionContext: HttpSessionContext,
    vaultName: string | null
  ): Promise<HttpVault | null> {
    const vaults = sessionContext?.vaults;
    let vault: HttpVault | null = null;
    if (vaults && typeof vaults.getByName === "function") {
      vault = await vaults.getByName(vaultName || null);
    } else if (vaults && typeof vaults.lookup === "function") {
      vault = await vaults.lookup({ name: vaultName || null });
    } else if (
      vaultName &&
      typeof this.vaultManager?.getVaultByName === "function"
    ) {
      // Compatibility bridge until VaultManager's scoped facade exposes
      // named lookup. Admission still happens before this call.
      vault = await this.vaultManager.getVaultByName(vaultName);
    } else if (!vaultName && this.vaultManager?.vaults instanceof Map) {
      vault = this.vaultManager.vaults.get("system") || null;
    } else if (!vaultName) {
      vault = sessionContext?.activeVault || null;
    }
    if (!vault || vault.isLocked) {
      return null;
    }
    return vault;
  }
  async handleAction(
    action: unknown,
    data: unknown
  ): Promise<ActionResponseShape> {
    if (action === "status") {
      return {
        data: {
          environmentProtocolVersion: ENVIRONMENT_PROTOCOL_VERSION,
          isUnlocked: this._getSessionState() === "active",
          version: APP_VERSION,
        },
        success: true,
      };
    }
    if (typeof action !== "string" || !SENSITIVE_ACTIONS.has(action)) {
      return { error: "Unknown action", success: false };
    }
    try {
      const safeData =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as ActionData)
          : {};
      if (!this.vaultSession) {
        const error = new Error("Vault is locked");
        error.code = "VAULT_SESSION_LOCKED";
        throw error;
      }
      return await this.vaultSession.withActiveSession(
        async (sessionContext: HttpSessionContext) => {
          const signal = sessionContext?.signal ?? null;
          this._throwIfAborted(signal);
          if (action === "listVaults") {
            const list = sessionContext?.vaults?.list;
            if (typeof list === "function") {
              return {
                data: await list.call(sessionContext.vaults),
                success: true,
              };
            }
            if (typeof this.vaultManager?.getVaultList === "function") {
              return { data: this.vaultManager.getVaultList(), success: true };
            }
            throw new Error("Vault list is unavailable");
          }
          const vault = await this._getVault(
            sessionContext,
            typeof safeData.vaultName === "string" ? safeData.vaultName : null
          );
          this._throwIfAborted(signal);
          if (!vault) {
            return { error: "Vault is locked", success: false };
          }
          return await this._handleVaultAction(action, safeData, vault, signal);
        }
      );
    } catch (error) {
      return this._publicError(error);
    }
  }
  async _handleVaultAction(
    action: string,
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    switch (action) {
      case "listProjects": {
        return await HttpServer._actionListProjects(safeData, vault, signal);
      }
      case "listEnvironments": {
        return await HttpServer._actionListEnvironments(
          safeData,
          vault,
          signal
        );
      }
      case "listSecretKeys": {
        return await this._actionListSecretKeys(safeData, vault, signal);
      }
      case "getAllSecrets": {
        return await this._actionGetAllSecrets(safeData, vault, signal);
      }
      case "getBatchSecrets": {
        return await this._actionGetBatchSecrets(safeData, vault, signal);
      }
      case "getSecret": {
        return await this._actionGetSecret(safeData, vault, signal);
      }
      case "setSecret": {
        return await this._actionSetSecret(safeData, vault, signal);
      }
      case "createProject": {
        return await this._actionCreateProject(safeData, vault, signal);
      }
      case "setBatchSecrets": {
        return await this._actionSetBatchSecrets(safeData, vault, signal);
      }
      default: {
        return { error: "Unknown action", success: false };
      }
    }
  }
  static _actionListProjects(
    _safeData: ActionData,
    vault: HttpVault,
    _signal: AbortSignal | null
  ): ActionResponseShape {
    let result: ActionResponseShape;
    {
      result = { data: vault.getProjects(), success: true };
      return result;
    }
  }
  static _actionListEnvironments(
    safeData: ActionData,
    vault: HttpVault,
    _signal: AbortSignal | null
  ): ActionResponseShape {
    let result: ActionResponseShape;
    {
      const { projectName } = safeData;
      if (
        typeof projectName !== "string" ||
        projectName.trim().length === 0 ||
        hasOwn(safeData, "environmentName") ||
        hasOwn(safeData, "environmentId")
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
  }
  async _actionListSecretKeys(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
    {
      {
        const captured = this._captureTarget(vault, safeData);
        const secrets = this._readSecrets(vault, captured);
        const keys = Object.keys(secrets);
        if (keys.length === 0) {
          result = { data: [], success: true };
        } else {
          const approvalResult = await this.requestBatchApproval(
            this._approvalRequest(captured, keys, "read"),
            signal
          );
          if (approvalResult.approved) {
            this._throwIfAborted(signal);
            this._assertFreshTarget(vault, captured, secrets);
            this._logCompletedRead(captured, keys);
            result = { data: keys, success: true };
          } else {
            const reason = approvalResult.reason || "User denied";
            result = { error: `Access denied: ${reason}`, success: false };
          }
        }
      }
      return result;
    }
  }
  async _actionGetAllSecrets(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
    {
      {
        const captured = this._captureTarget(vault, safeData);
        const secrets = this._readSecrets(vault, captured);
        const keys = Object.keys(secrets);
        if (keys.length === 0) {
          result = { data: {}, success: true };
        } else {
          const approvalResult = await this.requestBatchApproval(
            this._approvalRequest(captured, keys, "read"),
            signal
          );
          if (approvalResult.approved) {
            this._throwIfAborted(signal);
            // The pre-approval snapshot is only released when it still
            // matches the target exactly; a changed Environment is stale.
            this._assertFreshTarget(vault, captured, secrets);
            this._logCompletedRead(captured, keys);
            result = {
              data: this._readSecrets(vault, captured),
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
  }
  async _actionGetBatchSecrets(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
    {
      {
        const rawKeys = Array.isArray(safeData.keys) ? safeData.keys : [];
        const keys = rawKeys.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0
        );
        const captured = this._captureTarget(vault, safeData);
        const approvedSnapshot = this._readSecrets(vault, captured);
        const before: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
          before[key] = approvedSnapshot[key] ?? null;
        }
        const approvalResult = await this.requestBatchApproval(
          this._approvalRequest(captured, keys, "read"),
          signal
        );
        if (approvalResult.approved) {
          this._throwIfAborted(signal);
          this._assertFreshTarget(vault, captured, approvedSnapshot);
          this._logCompletedRead(captured, keys);
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
  }
  async _actionGetSecret(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
    {
      {
        const key = typeof safeData.key === "string" ? safeData.key : "";
        const captured = this._captureTarget(vault, safeData);
        const before = this._readSecret(vault, captured, key);
        const approvalResult = await this.requestBatchApproval(
          this._approvalRequest(captured, [key], "read"),
          signal
        );
        if (approvalResult.approved) {
          this._throwIfAborted(signal);
          this._assertFreshTarget(vault, captured);
          const value = this._readSecret(vault, captured, key);
          if (JSON.stringify(value) !== JSON.stringify(before)) {
            throw staleTargetError();
          }
          this._logCompletedRead(captured, [key]);
          result = { data: value, success: true };
        } else {
          const reason = approvalResult.reason || "User denied";
          result = { error: `Access denied: ${reason}`, success: false };
        }
      }
      return result;
    }
  }
  async _actionSetSecret(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
    {
      {
        const key = typeof safeData.key === "string" ? safeData.key : "";
        const captured = this._captureTarget(vault, safeData);
        const before = this._readSecrets(vault, captured)[key] ?? null;
        const approvalResult = await this.requestBatchApproval(
          this._approvalRequest(captured, [key], "write"),
          signal
        );
        if (approvalResult.approved) {
          this._throwIfAborted(signal);
          this._assertFreshTarget(vault, captured);
          if (
            JSON.stringify(this._readSecrets(vault, captured)[key] ?? null) !==
            JSON.stringify(before)
          ) {
            throw staleTargetError();
          }
          vault.setSecret(captured.target, key, safeData.value);
          await vault.saveNow();
          this.logger?.logAccess?.(
            "Secret written",
            captured.identity.projectName,
            [key],
            { ...this._logTarget(captured), outcome: "approved" }
          );
          result = { success: true };
        } else {
          const reason = approvalResult.reason || "User denied";
          result = { error: `Access denied: ${reason}`, success: false };
        }
      }
      return result;
    }
  }
  async _actionCreateProject(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
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
              this.vaultManager
                ?.getVaultList?.()
                .find(
                  (entry: { id: string; name: string }) => entry.id === vaultId
                )?.name ||
              (vaultId === "system" || vaultId === null ? "System" : "Vault");
            const approvalResult = await this.requestBatchApproval(
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
              this._throwIfAborted(signal);
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
  }
  async _actionSetBatchSecrets(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<ActionResponseShape> {
    let result: ActionResponseShape;
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
            error:
              "secrets must be a non-empty object of string key/value pairs",
            success: false,
          };
        } else {
          const exists = projectExists(vault, projectName);
          if (exists) {
            const keys = entries.map(([key]) => key);
            const captured = this._captureTarget(vault, safeData);
            const approvedSnapshot = this._readSecrets(vault, captured);
            const before: Record<string, unknown> = Object.fromEntries(
              keys.map((key) => [key, approvedSnapshot[key] ?? null])
            );
            const approvalResult = await this.requestBatchApproval(
              this._approvalRequest(captured, keys, "write"),
              signal
            );
            if (approvalResult.approved) {
              this._throwIfAborted(signal);
              this._assertFreshTarget(vault, captured);
              for (const key of keys) {
                if (
                  JSON.stringify(
                    this._readSecrets(vault, captured)[key] ?? null
                  ) !== JSON.stringify(before[key])
                ) {
                  throw staleTargetError();
                }
              }
              for (const [key, value] of entries) {
                vault.setSecret(captured.target, key, value);
              }
              await vault.saveNow();
              this.logger?.logAccess?.(
                "Secrets written",
                captured.identity.projectName,
                keys,
                { ...this._logTarget(captured), outcome: "approved" }
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
  }
  _getSessionState() {
    try {
      return this.vaultSession?.snapshot()?.state || "locked";
    } catch {
      return "locked";
    }
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _publicError(
    error:
      | {
          code?: string;
          message?: string;
        }
      | null
      | undefined
  ): ActionResponseShape {
    const code = error?.code;
    const message =
      SESSION_STATE_ERRORS.get(code ?? "") || error?.message || String(error);
    const out: ActionResponseShape = { error: message, success: false };
    if (code) {
      (
        out as {
          code?: string;
        }
      ).code = code;
    }
    return out;
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _throwIfAborted(signal: AbortSignal | null) {
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
  }
  async _awaitWithAbort<T>(
    promise: Promise<T>,
    signal: AbortSignal | null
  ): Promise<T> {
    this._throwIfAborted(signal);
    if (!signal || typeof signal.addEventListener !== "function") {
      return await promise;
    }
    let onAbort: () => void = ignoreAbort;
    // AbortSignal supplies an event rather than a Promise.
    // eslint-disable-next-line promise/avoid-new
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        try {
          this._throwIfAborted(signal);
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
  }
  setApprovalCallback(handler: ApprovalCallbackShape) {
    this.approvalCallback = handler;
  }
  /**
   * Resolves the external selector exactly once. An omitted Environment name
   * resolves to the Project default; an explicitly supplied but malformed,
   * conflicting, or unknown Environment is rejected before approval instead of
   * degrading to the default.
   */
  _captureTarget(vault: HttpVault, data: ActionData): CapturedTarget {
    if (
      !data ||
      typeof data.projectName !== "string" ||
      data.projectName.trim().length === 0 ||
      hasOwn(data, "environmentId") ||
      (hasOwn(data, "environmentName") &&
        (typeof data.environmentName !== "string" ||
          data.environmentName.trim().length === 0))
    ) {
      throw invalidTargetError();
    }
    const selector = hasOwn(data, "environmentName")
      ? {
          environmentName: data.environmentName as string,
          projectName: data.projectName,
        }
      : { projectName: data.projectName };
    const target = vault.resolveEnvironmentTarget(selector);
    const identity = vault.getEnvironmentTargetIdentity(target);
    const vaultId = vault.getVaultId?.() || null;
    const vaultName =
      this.vaultManager
        ?.getVaultList?.()
        .find((entry: { id: string; name: string }) => entry.id === vaultId)
        ?.name ||
      (vaultId === "system" || vaultId === null ? "System" : "Vault");
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
  }
  /**
   * Every Secret read resolves the target again so a resolution failure can
   * never be swallowed and answered with credentials from another collection.
   */
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _readSecrets(
    vault: HttpVault,
    captured: CapturedTarget
  ): Record<string, unknown> {
    const target = vault.resolveEnvironmentTarget({
      environmentId: captured.target.environmentId,
      projectName: captured.target.projectName,
    });
    return vault.getSecrets(target);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _readSecret(vault: HttpVault, captured: CapturedTarget, key: string) {
    const target = vault.resolveEnvironmentTarget({
      environmentId: captured.target.environmentId,
      projectName: captured.target.projectName,
    });
    return vault.getSecret(target, key);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _assertFreshTarget(
    vault: HttpVault,
    captured: CapturedTarget,
    expectedSecrets?: unknown
  ) {
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
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _approvalRequest(
    captured: CapturedTarget,
    keys: string[],
    action: ApprovalActionShape
  ): ApprovalRequestShape {
    return {
      action,
      environmentId: captured.identity.environmentId,
      environmentName: captured.identity.environmentName,
      keys,
      projectName: captured.identity.projectName,
      vaultId: captured.vaultId,
      vaultInstanceId: captured.vaultInstanceId,
      vaultName: captured.vaultName,
    };
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _logTarget(captured: CapturedTarget) {
    return {
      action: "write" as const,
      environmentId: captured.identity.environmentId,
      environmentName: captured.identity.environmentName,
      projectName: captured.identity.projectName,
      vaultId: captured.vaultId,
      vaultInstanceId: captured.vaultInstanceId,
    };
  }
  _logCompletedRead(captured: CapturedTarget, keys: string[]) {
    this.logger?.logAccess?.(
      "Secret read",
      captured.identity.projectName,
      keys,
      { ...this._logTarget(captured), action: "read", outcome: "approved" }
    );
  }
  async requestBatchApproval(
    request: ApprovalRequestShape,
    signal: AbortSignal | null = null
  ): Promise<ApprovalDecisionShape> {
    if (!this.approvalCallback) {
      return { approved: false, reason: "No approval handler available" };
    }
    // Defer the callback into a microtask and read the current handler there.
    // eslint-disable-next-line promise/prefer-await-to-then
    const approval = Promise.resolve().then(() => {
      const handler = this.approvalCallback;
      if (!handler) {
        throw new TypeError("Approval handler is unavailable");
      }
      return handler(request, signal);
    });
    return await this._awaitWithAbort(approval, signal);
  }
}
// Type-only namespace retains the CommonJS public type API.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace HttpServer {
  export type RequestData = ActionData;
  export type Target = EnvironmentTarget;
  export type Captured = CapturedTarget;
  export type Identity = CapturedTarget["identity"];
  export type ApprovalRequest = ApprovalRequestShape;
  export type ApprovalDecision = ApprovalDecisionShape;
  export type ApprovalAction = ApprovalActionShape;
  export type ActionResponse = ActionResponseShape;
  export type Callback = ApprovalCallbackShape;
}
export = HttpServer;
