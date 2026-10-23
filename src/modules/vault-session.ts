/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  VaultSessionError,
  copyCredential,
  defaultScheduler,
  immutableCopy,
  normalizePolicy,
  readInitialPolicy,
  requireMethod,
  sanitizeRecovery,
  sanitizeVaultStatuses,
  sanitizeWarnings,
  sessionError,
  validateCloseRequest,
  validateDestroyRequest,
  validateOpenRequest,
  validateRecoveryRequest,
  zeroCredential,
} from "./vault-session-helpers.js";
import { startMonitors, stopMonitors } from "./vault-session-monitors.js";
import {
  activateRuntime,
  clearLoggerKey,
  createOperationContext,
  deactivateRuntime,
  hasDestructionTombstone,
} from "./vault-session-runtime.js";
import {
  buildCloseResult,
  buildDestroyResult,
  buildOpenResult,
  clearTransition,
  errorForState,
  getActiveVaultId,
  logFinalShutdownRecord,
  performClose,
  performDestroy,
  performOpen,
  recordWarning,
  trackTransition,
  upgradeCloseReason,
} from "./vault-session-transitions.js";
import type {
  ArtifactEntry,
  CloseReason,
  CloseRequest,
  CloseResult,
  DestroyRequest,
  DestroyResult,
  LeaseEntry,
  MonitorScheduler,
  MonitorIntervalHandles,
  OpenRequest,
  OpenResult,
  OperationContext,
  RecoveryEntry,
  RecoveryRequest,
  SessionPolicy,
  SessionSnapshot,
  SessionState,
  VaultSessionDependencies,
  VaultSessionHost,
  VaultStatusEntry,
  WarningEntry,
} from "./vault-session-types.js";

class VaultSession implements VaultSessionHost {
  static Error = VaultSessionError;

  vaultManager: any;
  recoveryStore: any;
  logger: any;
  securityCoordinator: any;
  httpIngress: any;
  settingsProvider: any;
  monitorScheduler: MonitorScheduler;
  onStateChange: ((snapshot: SessionSnapshot) => void) | null;

  _state: SessionState = "locked";
  _reason: string | null = null;
  _transitionId = 0;
  _transitionPromise: Promise<any> | null = null;
  _transitionKind: string | null = null;
  _openingController: AbortController | null = null;
  _closeReason: CloseReason | null = null;
  _leases = new Set<LeaseEntry>();
  _policy: SessionPolicy;
  _policyRevision = 0;
  _monitorGeneration = 0;
  _monitorHandles: MonitorIntervalHandles = {
    autoLock: null,
    diskSync: null,
  };
  _monitorTicks = new Set<Promise<any>>();
  _vaults: VaultStatusEntry[] = [];
  _warnings: WarningEntry[] = [];
  _recovery: RecoveryEntry[] = [];
  _contextFactory: ((signal: AbortSignal) => OperationContext) | null = null;
  _loggerKey: Buffer | null = null;

  constructor(dependencies: VaultSessionDependencies) {
    if (!dependencies || !dependencies.vaultManager) {
      throw new TypeError("vaultManager is required");
    }
    this.vaultManager = dependencies.vaultManager;
    this.recoveryStore = dependencies.recoveryStore || null;
    this.logger = dependencies.logger || null;
    this.securityCoordinator = dependencies.securityCoordinator || null;
    this.httpIngress = dependencies.httpIngress || null;
    this.settingsProvider = dependencies.settingsProvider || null;
    this.monitorScheduler = dependencies.monitorScheduler || defaultScheduler();
    this.onStateChange =
      typeof dependencies.onStateChange === "function"
        ? dependencies.onStateChange
        : null;
    this._policy = normalizePolicy(readInitialPolicy(this.settingsProvider));
  }

  async open(request: Partial<OpenRequest> = {}): Promise<OpenResult> {
    validateOpenRequest(request);
    if (this._state === "active") {
      return this._openResult("already_active", false);
    }
    if (this._state === "opening") {
      throw sessionError(
        "VAULT_SESSION_TRANSITION_IN_PROGRESS",
        "A Vault session is already opening"
      );
    }
    if (this._state !== "locked") {
      throw this._errorForState();
    }

    const { credential: rawCredential, reason: openReason = "manual" } =
      request;
    const credential = copyCredential(rawCredential ?? "");
    const controller = new AbortController();
    this._openingController = controller;
    this._beginTransition("opening", openReason);

    const promise = performOpen(
      this,
      request as OpenRequest,
      credential,
      controller.signal
    );
    this._trackTransition("open", promise);
    try {
      return await promise;
    } finally {
      zeroCredential(credential);
      if (this._openingController === controller) {
        this._openingController = null;
      }
      this._clearTransition(promise);
    }
  }

  async close(request: Partial<CloseRequest> = {}): Promise<CloseResult> {
    validateCloseRequest(request);
    const closeReason = request.reason ?? "manual";
    if (this._state === "locked") {
      return this._closeResult("already_locked", closeReason, []);
    }
    if (this._state === "destroying") {
      throw this._errorForState();
    }

    if (this._state === "opening") {
      this._openingController?.abort(
        sessionError("VAULT_SESSION_CLOSING", "Opening was cancelled by close")
      );
      const opening = this._transitionPromise;
      try {
        await opening;
      } catch {
        // Opening can fail after cancellation; closing resumes from the resulting state.
      }
      if ((this._state as SessionState) === "locked") {
        return this._closeResult("already_locked", closeReason, []);
      }
      return this.close(request);
    }

    if (this._state === "closing") {
      this._upgradeCloseReason(closeReason);
      return this._transitionPromise as Promise<CloseResult>;
    }

    if (this._state !== "active" && this._state !== "recovering") {
      throw this._errorForState();
    }

    this._closeReason = closeReason;
    this._beginTransition("closing", closeReason);
    const promise = performClose(this, request.deadlineMs);
    this._trackTransition("close", promise);
    try {
      return await promise;
    } finally {
      this._clearTransition(promise);
      if ((this._state as SessionState) !== "closing") {
        this._closeReason = null;
      }
    }
  }

  async destroy(request: Partial<DestroyRequest> = {}): Promise<DestroyResult> {
    validateDestroyRequest(request);

    if (this._state === "destroying") {
      return this._transitionPromise as Promise<DestroyResult>;
    }
    if (this._state === "opening") {
      this._openingController?.abort(
        sessionError(
          "VAULT_SESSION_DESTROYING",
          "Opening was cancelled by destruction"
        )
      );
      const opening = this._transitionPromise;
      try {
        await opening;
      } catch {
        // A prior transition can fail; destruction resumes from the resulting state.
      }
      return this.destroy(request);
    }
    if (this._state === "closing") {
      if (this._closeReason === "quit") {
        throw sessionError(
          "VAULT_SESSION_SHUTDOWN_IN_PROGRESS",
          "Shutdown is already in progress"
        );
      }
      const closing = this._transitionPromise;
      try {
        await closing;
      } catch {
        // A prior transition can fail; destruction resumes from the resulting state.
      }
      return this.destroy(request);
    }

    const canResume =
      this._state === "locked" && (await hasDestructionTombstone(this));
    const canDestroy =
      this._state === "active" || this._state === "recovering" || canResume;
    if (!canDestroy) {
      throw this._errorForState();
    }

    const previousState = this._state;
    this._beginTransition("destroying", "delete");
    const promise = performDestroy(
      this,
      request.deadlineMs,
      previousState,
      canResume
    );
    this._trackTransition("destroy", promise);
    try {
      return await promise;
    } finally {
      this._clearTransition(promise);
    }
  }

  async withActiveSession<T = any>(
    operation: (context: any) => Promise<T> | T
  ): Promise<T> {
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function");
    }
    if (this._state !== "active") {
      throw this._errorForState();
    }

    const controller = new AbortController();
    let settle!: () => void;
    // eslint-disable-next-line promise/avoid-new
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const lease: LeaseEntry = { controller, settled };
    this._leases.add(lease);

    try {
      const context = createOperationContext(this, controller.signal);
      return await operation(context);
    } finally {
      this._leases.delete(lease);
      settle();
    }
  }

  async resolveRecovery(
    request: Partial<RecoveryRequest> = {}
  ): Promise<SessionSnapshot> {
    validateRecoveryRequest(request);
    if (this._state !== "recovering") {
      throw this._errorForState();
    }
    if (this._transitionPromise) {
      throw sessionError(
        "VAULT_SESSION_TRANSITION_IN_PROGRESS",
        "A recovery decision is already being applied"
      );
    }

    const resolver = requireMethod(this.vaultManager, "resolveRecovery");
    const promise = (async () => {
      const result =
        ((await resolver.call(this.vaultManager, { ...request })) as {
          recovery?: unknown[];
          remainingRecovery?: unknown[];
          state?: SessionState;
          systemDiscarded?: boolean;
          vaults?: unknown[];
          warnings?: unknown[];
        }) || {};
      this._vaults = sanitizeVaultStatuses(result.vaults ?? this._vaults);
      this._warnings = sanitizeWarnings(result.warnings ?? this._warnings);
      this._recovery = sanitizeRecovery(
        result.recovery ?? result.remainingRecovery ?? []
      );

      if (
        result.state === "locked" ||
        (request.decision === "discard" && result.systemDiscarded === true)
      ) {
        await deactivateRuntime(this, { seal: true });
        this._setState("locked", null);
        return this.snapshot();
      }
      if (this._recovery.length > 0) {
        return this.snapshot();
      }

      this._captureRuntime(result);
      await activateRuntime(this);
      this._setState("active", null);
      return this.snapshot();
    })();
    this._trackTransition("recovery", promise);
    try {
      return await promise;
    } finally {
      this._clearTransition(promise);
    }
  }

  async configure(policy: unknown = {}): Promise<SessionSnapshot> {
    const normalized = normalizePolicy(policy, this._policy);
    this._policy = normalized;
    this._policyRevision += 1;
    const revision = this._policyRevision;

    const transition = this._transitionPromise;
    if (transition) {
      try {
        await transition;
      } catch {
        // Policy updates remain valid even when the in-flight transition fails.
      }
      return this.snapshot();
    }
    if (revision !== this._policyRevision) {
      return this.snapshot();
    }
    if (this._state === "active") {
      startMonitors(this);
    } else {
      stopMonitors(this);
    }
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    return immutableCopy({
      activeVaultId: this._state === "active" ? this._getActiveVaultId() : null,
      reason: this._reason,
      recovery: this._recovery,
      state: this._state,
      transitionId: this._transitionId,
      warnings: this._warnings,
    });
  }

  _captureRuntime(result: unknown): void {
    const data =
      (result as {
        createContext?: (sig: AbortSignal) => OperationContext;
        loggerKey?: Buffer | null;
        recovery?: unknown[];
        vaults?: unknown[];
        warnings?: unknown[];
      }) || {};
    this._vaults = sanitizeVaultStatuses(data.vaults ?? []);
    this._warnings = sanitizeWarnings(data.warnings ?? []);
    this._recovery = sanitizeRecovery(data.recovery ?? []);
    if (Object.hasOwn(data, "createContext")) {
      this._contextFactory =
        typeof data.createContext === "function" ? data.createContext : null;
    }
    if (Object.hasOwn(data, "loggerKey")) {
      this._clearLoggerKey();
      this._loggerKey = Buffer.isBuffer(data.loggerKey)
        ? Buffer.from(data.loggerKey)
        : (data.loggerKey ?? null);
    }
  }

  _upgradeCloseReason(reason: CloseReason): void {
    upgradeCloseReason(this, reason);
  }

  _beginTransition(state: SessionState, reason: string | null): void {
    this._transitionId += 1;
    this._setState(state, reason);
  }

  _setState(state: SessionState, reason: string | null): void {
    this._state = state;
    this._reason = reason;
    if (!this.onStateChange) {
      return;
    }
    const snapshot = this.snapshot();
    queueMicrotask(() => {
      try {
        this.onStateChange?.(snapshot);
      } catch {
        // State observers must not interrupt session transitions.
      }
    });
  }

  _trackTransition(kind: string, promise: Promise<any>): void {
    trackTransition(this, kind, promise);
  }

  _clearTransition(promise: Promise<any>): void {
    clearTransition(this, promise);
  }

  _getActiveVaultId(): string {
    return getActiveVaultId(this);
  }

  _errorForState(): VaultSessionError {
    return errorForState(this);
  }

  _openResult(outcome: string, provisioned: boolean): OpenResult {
    return buildOpenResult(this, outcome, provisioned);
  }

  _closeResult(
    outcome: string,
    reason: CloseReason,
    vaults: VaultStatusEntry[]
  ): CloseResult {
    return buildCloseResult(this, outcome, reason, vaults);
  }

  _destroyResult(outcome: string, artifacts: ArtifactEntry[]): DestroyResult {
    return buildDestroyResult(this, outcome, artifacts);
  }

  _recordWarning(code: string): void {
    recordWarning(this, code);
  }

  _logFinalShutdownRecord(): void {
    logFinalShutdownRecord(this);
  }

  _clearLoggerKey(): void {
    clearLoggerKey(this);
  }
}

export = VaultSession;
