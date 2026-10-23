import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type { AgentProxySessionInfo } from "./agent-proxy-contracts";
import {
  httpActionListProjects,
  httpActionListEnvironments,
  httpActionListSecretKeys,
  httpActionGetAllSecrets,
  httpActionGetBatchSecrets,
  httpActionGetSecret,
  httpActionSetSecret,
  httpActionCreateProject,
  httpActionSetBatchSecrets,
} from "./http-server-actions";
import {
  httpPublicError,
  httpThrowIfAborted,
  httpAwaitWithAbort,
  httpCaptureTarget,
  httpReadSecrets,
  httpReadSecret,
  httpAssertFreshTarget,
  httpApprovalRequest,
  httpLogTarget,
  httpLogCompletedRead,
  httpRequestBatchApproval,
} from "./http-server-approval";
import type {
  ActionData,
  EnvironmentTarget,
  CapturedTarget,
  HttpApprovalAction,
  HttpApprovalRequest,
  HttpApprovalDecision,
  HttpApprovalCallback,
  HttpActionResponse,
  HttpVault,
  HttpManager,
  HttpLogger,
  HttpSessionContext,
  HttpSession,
} from "./http-server-contracts";
import {
  httpGetVault,
  httpHandleAction,
  httpGetSessionState,
} from "./http-server-dispatch";
import {
  httpGenerateAuthToken,
  httpStart,
  httpStop,
  httpAuthenticateRequest,
  httpSetCorsHeaders,
  httpHandleRequest,
  httpParseRequestBody,
} from "./http-server-transport";

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
  approvalCallback: HttpApprovalCallback | null;
  agentProxy: {
    close: (sessionId: string) => void;
    createSession: (data: unknown) => Promise<AgentProxySessionInfo>;
  } | null;
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
    this.agentProxy = null;
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
  bindAgentProxy(coordinator: NonNullable<HttpServer["agentProxy"]>) {
    this.agentProxy = coordinator;
    return this;
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  generateAuthToken(): ReturnType<typeof httpGenerateAuthToken> {
    return httpGenerateAuthToken();
  }
  // Preserve asynchronous rejection when constructing or binding the server fails.
  async start(): ReturnType<typeof httpStart> {
    return await httpStart(this);
  }
  // Preserve the Promise-returning shutdown API, including synchronous failures.
  async stop(): Promise<void> {
    return await httpStop(this);
  }
  authenticateRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): ReturnType<typeof httpAuthenticateRequest> {
    return httpAuthenticateRequest(this, req, res);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  setCorsHeaders(res: ServerResponse): ReturnType<typeof httpSetCorsHeaders> {
    return httpSetCorsHeaders(res);
  }
  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): ReturnType<typeof httpHandleRequest> {
    return await httpHandleRequest(this, req, res);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  parseRequestBody(
    req: IncomingMessage
  ): ReturnType<typeof httpParseRequestBody> {
    return httpParseRequestBody(req);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  async _getVault(
    sessionContext: HttpSessionContext,
    vaultName: string | null
  ): Promise<HttpVault | null> {
    return await httpGetVault(sessionContext, vaultName);
  }
  async handleAction(
    action: unknown,
    data: unknown
  ): Promise<HttpActionResponse> {
    return await httpHandleAction(this, action, data);
  }
  async _handleVaultAction(
    action: string,
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
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
  ): HttpActionResponse {
    return httpActionListProjects(_safeData, vault, _signal);
  }
  static _actionListEnvironments(
    safeData: ActionData,
    vault: HttpVault,
    _signal: AbortSignal | null
  ): HttpActionResponse {
    return httpActionListEnvironments(safeData, vault, _signal);
  }
  async _actionListSecretKeys(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionListSecretKeys(this, safeData, vault, signal);
  }
  async _actionGetAllSecrets(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionGetAllSecrets(this, safeData, vault, signal);
  }
  async _actionGetBatchSecrets(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionGetBatchSecrets(this, safeData, vault, signal);
  }
  async _actionGetSecret(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionGetSecret(this, safeData, vault, signal);
  }
  async _actionSetSecret(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionSetSecret(this, safeData, vault, signal);
  }
  async _actionCreateProject(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionCreateProject(this, safeData, vault, signal);
  }
  async _actionSetBatchSecrets(
    safeData: ActionData,
    vault: HttpVault,
    signal: AbortSignal | null
  ): Promise<HttpActionResponse> {
    return await httpActionSetBatchSecrets(this, safeData, vault, signal);
  }
  _getSessionState(): ReturnType<typeof httpGetSessionState> {
    return httpGetSessionState(this);
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
  ): HttpActionResponse {
    return httpPublicError(error);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _throwIfAborted(
    signal: AbortSignal | null
  ): ReturnType<typeof httpThrowIfAborted> {
    return httpThrowIfAborted(signal);
  }
  async _awaitWithAbort<T>(
    promise: Promise<T>,
    signal: AbortSignal | null
  ): Promise<T> {
    return await httpAwaitWithAbort<T>(this, promise, signal);
  }
  setApprovalCallback(handler: HttpApprovalCallback) {
    this.approvalCallback = handler;
  }
  /**
   * Resolves the external selector exactly once. An omitted Environment name
   * resolves to the Project default; an explicitly supplied but malformed,
   * conflicting, or unknown Environment is rejected before approval instead of
   * degrading to the default.
   */
  _captureTarget(vault: HttpVault, data: ActionData): CapturedTarget {
    return httpCaptureTarget(this, vault, data);
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
    return httpReadSecrets(vault, captured);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _readSecret(
    vault: HttpVault,
    captured: CapturedTarget,
    key: string
  ): ReturnType<typeof httpReadSecret> {
    return httpReadSecret(vault, captured, key);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _assertFreshTarget(
    vault: HttpVault,
    captured: CapturedTarget,
    expectedSecrets?: unknown
  ): ReturnType<typeof httpAssertFreshTarget> {
    return httpAssertFreshTarget(vault, captured, expectedSecrets);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _approvalRequest(
    captured: CapturedTarget,
    keys: string[],
    action: HttpApprovalAction
  ): HttpApprovalRequest {
    return httpApprovalRequest(captured, keys, action);
  }
  // Keep the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _logTarget(captured: CapturedTarget): ReturnType<typeof httpLogTarget> {
    return httpLogTarget(captured);
  }
  _logCompletedRead(
    captured: CapturedTarget,
    keys: string[]
  ): ReturnType<typeof httpLogCompletedRead> {
    return httpLogCompletedRead(this, captured, keys);
  }
  async requestBatchApproval(
    request: HttpApprovalRequest,
    signal: AbortSignal | null = null
  ): Promise<HttpApprovalDecision> {
    return await httpRequestBatchApproval(this, request, signal);
  }
}
// Type-only namespace retains the CommonJS public type API.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace HttpServer {
  export type RequestData = ActionData;
  export type Target = EnvironmentTarget;
  export type Captured = CapturedTarget;
  export type Identity = CapturedTarget["identity"];
  export type ApprovalRequest = HttpApprovalRequest;
  export type ApprovalDecision = HttpApprovalDecision;
  export type ApprovalAction = HttpApprovalAction;
  export type ActionResponse = HttpActionResponse;
  export type Callback = HttpApprovalCallback;
}
export = HttpServer;
