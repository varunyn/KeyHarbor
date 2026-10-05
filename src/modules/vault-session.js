/* eslint-disable max-classes-per-file -- VaultSession.Error is the exported session API's error constructor. */
"use strict";

// eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
const STATE_ERROR_CODES = Object.freeze({
  locked: "VAULT_SESSION_LOCKED",
  opening: "VAULT_SESSION_OPENING",
  recovering: "VAULT_SESSION_RECOVERING",
  closing: "VAULT_SESSION_CLOSING",
  destroying: "VAULT_SESSION_DESTROYING",
});

// eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
const CLOSE_PRIORITY = Object.freeze({ manual: 0, idle: 1, quit: 2 });
const OPEN_METHODS = new Set(["setup", "password", "key"]);
const OPEN_REASONS = new Set(["setup", "manual", "touch_id"]);
const CLOSE_REASONS = new Set(Object.keys(CLOSE_PRIORITY));
const RECOVERY_DECISIONS = new Set([
  "keep_recovered",
  "use_current",
  "discard",
  "defer",
]);

const sanitize = (value) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (/credential|password|secret|key|data|payload|bytes/iu.test(key)) {
        continue;
      }
      output[key] = sanitize(item);
    }
    return output;
  }
  return String(value);
};

class VaultSessionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "VaultSessionError";
    this.code = code;
    if (details !== undefined) {
      this.details = sanitize(details);
    }
  }
}

// eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
const defaultScheduler = () => ({
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle),
  getIdleTimeSeconds: () => 0,
});

const normalizePolicy = (policy, fallback = {}) => {
  const source =
    policy && typeof policy === "object" && !Array.isArray(policy)
      ? policy
      : {};
  const autoLockEnabled =
    source.autoLockEnabled ?? fallback.autoLockEnabled ?? false;
  const autoLockTimeoutSeconds =
    source.autoLockTimeoutSeconds ?? fallback.autoLockTimeoutSeconds ?? 1800;
  const diskSyncIntervalMs =
    source.diskSyncIntervalMs ?? fallback.diskSyncIntervalMs ?? 5000;
  if (typeof autoLockEnabled !== "boolean") {
    throw new TypeError("autoLockEnabled must be boolean");
  }
  if (!Number.isFinite(autoLockTimeoutSeconds) || autoLockTimeoutSeconds <= 0) {
    throw new TypeError("autoLockTimeoutSeconds must be positive");
  }
  if (!Number.isFinite(diskSyncIntervalMs) || diskSyncIntervalMs < 0) {
    throw new TypeError("diskSyncIntervalMs must be non-negative");
  }
  return Object.freeze({
    autoLockEnabled,
    autoLockTimeoutSeconds,
    diskSyncIntervalMs,
  });
};

const readInitialPolicy = (provider) => {
  if (!provider) {
    return {};
  }
  if (typeof provider === "function") {
    return provider() || {};
  }
  if (typeof provider.getPolicy === "function") {
    return provider.getPolicy() || {};
  }
  return {};
};

const validateOpenRequest = (request) => {
  if (!OPEN_METHODS.has(request.method)) {
    throw new TypeError("Invalid Vault session open method");
  }
  if (!OPEN_REASONS.has(request.reason)) {
    throw new TypeError("Invalid Vault session open reason");
  }
  if (request.credential === null || request.credential === undefined) {
    throw new TypeError("A credential is required");
  }
};

const sessionError = (code, message, details) =>
  new VaultSessionError(code, message, details);

const copyCredential = (credential) =>
  Buffer.isBuffer(credential) ? Buffer.from(credential) : credential;

const zeroCredential = (credential) => {
  if (Buffer.isBuffer(credential)) {
    credential.fill(0);
  }
};

const validateDeadline = (value) => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new TypeError("deadlineMs must be a non-negative number");
  }
};

const validateCloseRequest = (request) => {
  if (!CLOSE_REASONS.has(request.reason)) {
    throw new TypeError("Invalid Vault session close reason");
  }
  validateDeadline(request.deadlineMs);
};

const validateDestroyRequest = (request) => {
  if (request.confirmation !== "delete") {
    throw new TypeError("Destruction requires exact confirmation");
  }
  validateDeadline(request.deadlineMs);
};

const validateRecoveryRequest = (request) => {
  if (request.kind !== "vault" && request.kind !== "manager_config") {
    throw new TypeError("Invalid recovery kind");
  }
  if (typeof request.artifactId !== "string" || !request.artifactId) {
    throw new TypeError("artifactId is required");
  }
  if (typeof request.capsuleId !== "string" || !request.capsuleId) {
    throw new TypeError("capsuleId is required");
  }
  if (!RECOVERY_DECISIONS.has(request.decision)) {
    throw new TypeError("Invalid recovery decision");
  }
};

const requireMethod = (target, name) => {
  if (!target || typeof target[name] !== "function") {
    throw new TypeError(`vaultManager.${name}() is required`);
  }
  return target[name];
};

const safeString = (value, fallback) =>
  typeof value === "string" && value ? value : fallback;

const compact = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );

const safeOptionalString = (value) =>
  typeof value === "string" && value ? value : undefined;

const sanitizeVaultStatuses = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) => {
    const status =
      entry?.status === "unlocked"
        ? "active"
        : safeString(entry?.status, "failed");
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return compact({
      vaultId: safeString(entry?.vaultId, "unknown"),
      status,
      code: safeOptionalString(entry?.code),
    });
  });
};

const sanitizeWarnings = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) =>
    compact({
      code: safeString(entry?.code, "VAULT_SESSION_WARNING"),
      vaultId: safeOptionalString(entry?.vaultId),
    })
  );
};

const sanitizeRecovery = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return entries.map((entry) => ({
    kind: entry?.kind === "manager_config" ? "manager_config" : "vault",
    artifactId: safeString(entry?.artifactId, "unknown"),
    capsuleId: safeString(entry?.capsuleId, "unknown"),
    reason: safeString(entry?.reason, "recovery_required"),
    allowedDecisions: Array.isArray(entry?.allowedDecisions)
      ? entry.allowedDecisions.filter((value) => RECOVERY_DECISIONS.has(value))
      : [],
  }));
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const item of Object.values(value)) {
    deepFreeze(item);
  }
  return value;
};

// eslint-disable-next-line unicorn/prefer-structured-clone -- JSON normalization intentionally removes unsupported values before equality, persistence, or IPC.
const immutableCopy = (value) => deepFreeze(JSON.parse(JSON.stringify(value)));

const throwIfAborted = (signal) => {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : sessionError(
        "VAULT_SESSION_TRANSITION_IN_PROGRESS",
        "Transition was cancelled"
      );
};

const sanitizeCloseStatuses = (entries) => sanitizeVaultStatuses(entries);

const sanitizeArtifacts = (entries) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) =>
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    compact({
      kind: safeString(entry?.kind, "unknown"),
      status: safeString(entry?.status, "failed"),
      code: safeOptionalString(entry?.code),
    })
  );
};

const isStateError = (error) =>
  Boolean(
    error &&
    typeof error.code === "string" &&
    error.code.startsWith("VAULT_SESSION_")
  );

const delay = (milliseconds) =>
  // eslint-disable-next-line promise/avoid-new -- Lease settlement and deadline timers require externally completed promises.
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

class VaultSession {
  constructor(dependencies = {}) {
    if (!dependencies.vaultManager) {
      throw new TypeError("vaultManager is required");
    }

    this.vaultManager = dependencies.vaultManager;
    this.logger = dependencies.logger || null;
    this.httpIngress = dependencies.httpIngress || null;
    this.monitorScheduler = dependencies.monitorScheduler || defaultScheduler();
    this.settingsProvider = dependencies.settingsProvider || null;
    this.recoveryStore = dependencies.recoveryStore || null;
    this.securityCoordinator = dependencies.securityCoordinator || null;
    this.onStateChange =
      typeof dependencies.onStateChange === "function"
        ? dependencies.onStateChange
        : null;

    this._state = "locked";
    this._reason = null;
    this._transitionId = 0;
    this._transitionPromise = null;
    this._transitionKind = null;
    this._openingController = null;
    this._closeReason = null;
    this._leases = new Set();
    this._policy = normalizePolicy(readInitialPolicy(this.settingsProvider));
    this._policyRevision = 0;
    this._monitorGeneration = 0;
    this._monitorHandles = { autoLock: null, diskSync: null };
    this._monitorTicks = new Set();
    this._vaults = [];
    this._warnings = [];
    this._recovery = [];
    this._contextFactory = null;
    this._loggerKey = null;
  }

  async open(request = {}) {
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

    const credential = copyCredential(request.credential);
    const controller = new AbortController();
    this._openingController = controller;
    this._beginTransition("opening", request.reason);

    const promise = this._performOpen(request, credential, controller.signal);
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

  async close(request = {}) {
    validateCloseRequest(request);
    if (this._state === "locked") {
      return this._closeResult("already_locked", request.reason, []);
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
      if (this._state === "locked") {
        return this._closeResult("already_locked", request.reason, []);
      }
      return this.close(request);
    }

    if (this._state === "closing") {
      this._upgradeCloseReason(request.reason);
      return this._transitionPromise;
    }

    if (this._state !== "active" && this._state !== "recovering") {
      throw this._errorForState();
    }

    this._closeReason = request.reason;
    this._beginTransition("closing", request.reason);
    const promise = this._performClose(request.deadlineMs);
    this._trackTransition("close", promise);
    try {
      return await promise;
    } finally {
      this._clearTransition(promise);
      if (this._state !== "closing") {
        this._closeReason = null;
      }
    }
  }

  async destroy(request = {}) {
    validateDestroyRequest(request);

    if (this._state === "destroying") {
      return this._transitionPromise;
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
      this._state === "locked" && (await this._hasDestructionTombstone());
    const canDestroy =
      this._state === "active" || this._state === "recovering" || canResume;
    if (!canDestroy) {
      throw this._errorForState();
    }

    const previousState = this._state;
    this._beginTransition("destroying", "delete");
    const promise = this._performDestroy(
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

  async withActiveSession(operation) {
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function");
    }
    if (this._state !== "active") {
      throw this._errorForState();
    }

    const controller = new AbortController();
    let settle;
    // eslint-disable-next-line promise/avoid-new -- Lease settlement and deadline timers require externally completed promises.
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const lease = { controller, settled };
    this._leases.add(lease);

    try {
      const context = this._createOperationContext(controller.signal);
      return await operation(context);
    } finally {
      this._leases.delete(lease);
      settle();
    }
  }

  async resolveRecovery(request = {}) {
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
        (await resolver.call(this.vaultManager, { ...request })) || {};
      this._vaults = sanitizeVaultStatuses(result.vaults ?? this._vaults);
      this._warnings = sanitizeWarnings(result.warnings ?? this._warnings);
      this._recovery = sanitizeRecovery(
        result.recovery ?? result.remainingRecovery ?? []
      );

      if (
        result.state === "locked" ||
        (request.decision === "discard" && result.systemDiscarded === true)
      ) {
        await this._deactivateRuntime({ seal: true });
        this._setState("locked", null);
        return this.snapshot();
      }
      if (this._recovery.length > 0) {
        return this.snapshot();
      }

      this._captureRuntime(result);
      await this._activateRuntime();
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

  async configure(policy = {}) {
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
      this._startMonitors();
    } else {
      this._stopMonitors();
    }
    return this.snapshot();
  }

  snapshot() {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return immutableCopy({
      state: this._state,
      transitionId: this._transitionId,
      reason: this._reason,
      activeVaultId: this._state === "active" ? this._getActiveVaultId() : null,
      recovery: this._recovery,
      warnings: this._warnings,
    });
  }

  async _performOpen(request, credential, signal) {
    let provisioned = false;
    try {
      await this._disableIngress();
      this._stopMonitors();
      const headers =
        this.recoveryStore && typeof this.recoveryStore.enumerate === "function"
          ? await this.recoveryStore.enumerate()
          : [];
      throwIfAborted(signal);
      const opener = requireMethod(this.vaultManager, "openSession");
      const result =
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        (await opener.call(this.vaultManager, {
          method: request.method,
          credential,
          reason: request.reason,
          recoveryHeaders: headers,
          signal,
        })) || {};
      provisioned = result.provisioned === true;
      throwIfAborted(signal);
      this._captureRuntime(result);

      if (this._recovery.length > 0 || result.state === "recovering") {
        this._setState("recovering", this._reason);
        return this._openResult("recovery_required", provisioned);
      }

      await this._activateRuntime();
      throwIfAborted(signal);
      this._setState("active", null);
      return this._openResult("opened", provisioned);
    } catch (error) {
      await this._rollbackOpen();
      this._setState("locked", null);
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
  }

  async _performClose(deadlineMs) {
    await this._disableIngress();
    this._stopMonitors();
    this._abortLeases();

    const reasonAtDrain = this._closeReason;
    const drained = await this._drainLeases(
      deadlineMs,
      reasonAtDrain === "idle"
    );
    if (!drained) {
      const reason = this._closeReason;
      if (reason === "idle") {
        await this._drainLeases(undefined, true);
      } else {
        if (reason === "manual") {
          await this._restoreActiveRuntime();
          this._setState("active", null);
        }
        return this._closeResult("drain_timeout", reason, []);
      }
    }

    let reason = this._closeReason;
    const wasRecovering = this._recovery.length > 0;
    let vaults = [];
    if (!wasRecovering) {
      const prepare = requireMethod(this.vaultManager, "prepareClose");
      const prepared =
        (await prepare.call(this.vaultManager, { reason })) || {};
      vaults = sanitizeCloseStatuses(prepared.vaults ?? prepared.results ?? []);
      if (
        prepared.config &&
        typeof prepared.config.status === "string" &&
        !vaults.some((entry) => entry.vaultId === "manager_config")
      ) {
        vaults.push(
          // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
          compact({
            vaultId: "manager_config",
            status: prepared.config.status,
            code: safeOptionalString(prepared.config.code),
          })
        );
      }
      this._warnings = sanitizeWarnings(prepared.warnings ?? []);
      reason = this._closeReason;
    }

    const blocked = vaults.some(
      (entry) =>
        entry.status === "needs_resolution" || entry.status === "failed"
    );
    if (reason === "manual" && blocked) {
      await this._restoreActiveRuntime();
      this._setState("active", null);
      return this._closeResult("blocked", reason, vaults);
    }

    let recoveryFailed = false;
    if ((reason === "idle" || reason === "quit") && blocked) {
      const recovery = await this._persistRecovery(vaults);
      recoveryFailed = recovery.failed;
      ({ vaults } = recovery);
    }

    if (reason === "quit") {
      this._logFinalShutdownRecord();
    }
    await this._deactivateRuntime({ seal: true });
    this._setState("locked", null);
    return this._closeResult(
      recoveryFailed ? "recovery_failed" : "closed",
      reason,
      vaults
    );
  }

  async _performDestroy(deadlineMs, previousState, resuming) {
    await this._disableIngress();
    this._stopMonitors();
    this._abortLeases();
    const drained = await this._drainLeases(deadlineMs, false);
    if (!drained) {
      if (previousState === "active") {
        await this._restoreActiveRuntime();
      }
      this._setState(previousState, null);
      return this._destroyResult("drain_timeout", []);
    }

    if (
      !resuming &&
      this.recoveryStore &&
      typeof this.recoveryStore.beginDestruction === "function"
    ) {
      await this.recoveryStore.beginDestruction();
    }
    await this._deactivateRuntime({ seal: true });
    const destroyer = requireMethod(this.vaultManager, "destroySession");
    const result =
      (await destroyer.call(this.vaultManager, { resume: resuming })) || {};
    const artifacts = sanitizeArtifacts(result.artifacts ?? []);
    const failed = artifacts.some((entry) => entry.status === "failed");
    if (
      !failed &&
      this.recoveryStore &&
      typeof this.recoveryStore.finishDestruction === "function"
    ) {
      await this.recoveryStore.finishDestruction();
    }
    this._vaults = [];
    this._warnings = sanitizeWarnings(result.warnings ?? []);
    this._recovery = [];
    this._setState("locked", null);
    const completedOutcome = result.alreadyAbsent
      ? "already_absent"
      : "destroyed";
    return this._destroyResult(
      failed || result.partialFailure ? "partial_failure" : completedOutcome,
      artifacts
    );
  }

  _captureRuntime(result) {
    this._vaults = sanitizeVaultStatuses(result.vaults ?? []);
    this._warnings = sanitizeWarnings(result.warnings ?? []);
    this._recovery = sanitizeRecovery(result.recovery ?? []);
    if (Object.hasOwn(result, "createContext")) {
      this._contextFactory =
        typeof result.createContext === "function"
          ? result.createContext
          : null;
    }
    if (Object.hasOwn(result, "loggerKey")) {
      this._clearLoggerKey();
      this._loggerKey = Buffer.isBuffer(result.loggerKey)
        ? Buffer.from(result.loggerKey)
        : (result.loggerKey ?? null);
    }
  }

  async _activateRuntime() {
    if (
      this.logger &&
      this._loggerKey !== null &&
      this._loggerKey !== undefined
    ) {
      const install = this.logger.setEncryptionKey || this.logger.installKey;
      if (typeof install === "function") {
        await install.call(this.logger, this._loggerKey);
      }
    }
    await this._enableIngress();
    this._startMonitors();
  }

  async _restoreActiveRuntime() {
    await this._enableIngress();
    this._startMonitors(true);
  }

  async _deactivateRuntime({ seal }) {
    this._stopMonitors();
    await this._disableIngress();
    if (this.logger) {
      const clear = this.logger.clearEncryptionKey || this.logger.clearKey;
      if (typeof clear === "function") {
        await clear.call(this.logger);
      }
    }
    this._clearLoggerKey();
    if (seal && typeof this.vaultManager.sealSession === "function") {
      await this.vaultManager.sealSession();
    }
    if (seal && typeof this.vaultManager.resetSession === "function") {
      await this.vaultManager.resetSession();
    }
    this._contextFactory = null;
    this._vaults = [];
    this._recovery = [];
  }

  async _rollbackOpen() {
    this._stopMonitors();
    await this._disableIngress();
    if (typeof this.vaultManager.rollbackOpen === "function") {
      try {
        await this.vaultManager.rollbackOpen();
      } catch {
        // Rollback is best effort; remaining runtime cleanup must still run.
      }
    } else if (typeof this.vaultManager.sealSession === "function") {
      try {
        await this.vaultManager.sealSession();
      } catch {
        // Rollback is best effort; remaining runtime cleanup must still run.
      }
    }
    if (this.logger) {
      const clear = this.logger.clearEncryptionKey || this.logger.clearKey;
      if (typeof clear === "function") {
        try {
          await clear.call(this.logger);
        } catch {
          // Rollback is best effort; remaining runtime cleanup must still run.
        }
      }
    }
    this._clearLoggerKey();
    this._contextFactory = null;
    this._vaults = [];
    this._recovery = [];
  }

  _createOperationContext(signal) {
    let context;
    if (this._contextFactory) {
      context = this._contextFactory(signal);
    } else if (typeof this.vaultManager.createSessionContext === "function") {
      context = this.vaultManager.createSessionContext(signal);
    } else if (typeof this.vaultManager.getSessionContext === "function") {
      context = this.vaultManager.getSessionContext(signal);
    } else {
      throw new TypeError(
        "vaultManager must provide createSessionContext(signal)"
      );
    }

    const baseSecurity =
      context.security && typeof context.security === "object"
        ? context.security
        : {};
    const security = Object.freeze({
      ...baseSecurity,
      changePassword: async (currentPassword, newPassword) => {
        const rotate = requireMethod(this.vaultManager, "changeSystemPassword");
        const result = await rotate.call(
          this.vaultManager,
          currentPassword,
          newPassword
        );
        const copyKey = requireMethod(this.vaultManager, "copySystemKey");
        const key = copyKey.call(this.vaultManager);
        try {
          this._clearLoggerKey();
          this._loggerKey = Buffer.from(key);
          if (this.logger) {
            const install =
              this.logger.setEncryptionKey || this.logger.installKey;
            if (typeof install === "function") {
              await install.call(this.logger, this._loggerKey);
            }
          }
          if (
            this.securityCoordinator &&
            typeof this.securityCoordinator.afterKeyRotation === "function"
          ) {
            await this.securityCoordinator.afterKeyRotation(key);
          }
        } finally {
          key.fill(0);
        }
        return result;
      },
    });
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return Object.freeze({ ...context, signal, security });
  }

  _clearLoggerKey() {
    if (Buffer.isBuffer(this._loggerKey)) {
      this._loggerKey.fill(0);
    }
    this._loggerKey = null;
  }

  _startMonitors(force = false) {
    this._stopMonitors();
    if (!force && this._state !== "active" && this._state !== "opening") {
      return;
    }
    const generation = this._monitorGeneration;

    if (this._policy.autoLockEnabled) {
      this._monitorHandles.autoLock = this.monitorScheduler.setInterval(
        () => {
          this._runAutoLockTick(generation);
        },
        Math.min(10_000, this._policy.autoLockTimeoutSeconds * 1000)
      );
    }
    if (this._policy.diskSyncIntervalMs > 0) {
      this._monitorHandles.diskSync = this.monitorScheduler.setInterval(() => {
        this._runMonitorTick(generation, async () => {
          await this.withActiveSession((context) => {
            if (
              context.vaults &&
              typeof context.vaults.syncAll === "function"
            ) {
              return context.vaults.syncAll();
            }
            if (typeof this.vaultManager.syncAllVaults === "function") {
              return this.vaultManager.syncAllVaults();
            }
          });
        });
      }, this._policy.diskSyncIntervalMs);
    }
  }

  _stopMonitors() {
    this._monitorGeneration += 1;
    for (const key of Object.keys(this._monitorHandles)) {
      const handle = this._monitorHandles[key];
      if (handle !== null && handle !== undefined) {
        this.monitorScheduler.clearInterval(handle);
      }
      this._monitorHandles[key] = null;
    }
  }

  _runMonitorTick(generation, operation) {
    if (generation !== this._monitorGeneration || this._state !== "active") {
      return;
    }
    const promise = Promise.resolve()
      // eslint-disable-next-line promise/prefer-await-to-then -- Preserve monitor/drain microtask ordering and tracked promise identity.
      .then(operation)
      // eslint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Preserve monitor callback scheduling and tracked promise identity. Preserve monitor/drain microtask ordering and tracked promise identity.
      .catch((error) => {
        if (!isStateError(error)) {
          this._recordWarning("VAULT_SESSION_MONITOR_FAILED");
        }
      })
      // eslint-disable-next-line promise/prefer-await-to-then -- Preserve monitor/drain microtask ordering and tracked promise identity.
      .finally(() => this._monitorTicks.delete(promise));
    this._monitorTicks.add(promise);
  }

  _runAutoLockTick(generation) {
    if (generation !== this._monitorGeneration || this._state !== "active") {
      return;
    }
    Promise.resolve(this.monitorScheduler.getIdleTimeSeconds())
      // eslint-disable-next-line promise/prefer-await-to-then -- Preserve monitor/drain microtask ordering and tracked promise identity.
      .then((idle) => {
        if (
          generation !== this._monitorGeneration ||
          this._state !== "active"
        ) {
          return;
        }
        if (idle >= this._policy.autoLockTimeoutSeconds) {
          return this.close({ reason: "idle" });
        }
      })
      // eslint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Preserve monitor callback scheduling and tracked promise identity. Preserve monitor/drain microtask ordering and tracked promise identity.
      .catch((error) => {
        if (!isStateError(error)) {
          this._recordWarning("VAULT_SESSION_MONITOR_FAILED");
        }
      });
  }

  _abortLeases() {
    for (const lease of this._leases) {
      lease.controller.abort(
        sessionError("VAULT_SESSION_CLOSING", "Session is closing")
      );
    }
  }

  // eslint-disable-next-line require-await -- Retain the async API boundary and its promise rejection contract.
  async _drainLeases(deadlineMs, ignoreDeadline) {
    const pending = [...this._leases].map((lease) => lease.settled);
    pending.push(...this._monitorTicks);
    if (pending.length === 0) {
      return true;
    }
    // eslint-disable-next-line promise/prefer-await-to-then -- Preserve monitor/drain microtask ordering and tracked promise identity.
    const drain = Promise.allSettled(pending).then(() => true);
    if (ignoreDeadline || deadlineMs === null || deadlineMs === undefined) {
      return drain;
    }
    // eslint-disable-next-line promise/prefer-await-to-then -- Preserve monitor/drain microtask ordering and tracked promise identity.
    return Promise.race([drain, delay(deadlineMs).then(() => false)]);
  }

  async _persistRecovery(vaults) {
    if (
      !this.recoveryStore ||
      typeof this.recoveryStore.writeCapsule !== "function"
    ) {
      return { failed: true, vaults };
    }
    let failed = false;
    const next = [];
    for (const entry of vaults) {
      if (entry.status !== "failed" && entry.status !== "needs_resolution") {
        next.push(entry);
        continue;
      }
      try {
        const record =
          typeof this.vaultManager.getRecoveryRecord === "function"
            ? // eslint-disable-next-line no-await-in-loop -- Recovery capsules must be written in vault order before session sealing.
              await this.vaultManager.getRecoveryRecord(entry.vaultId)
            : { vaultId: entry.vaultId };
        // eslint-disable-next-line no-await-in-loop -- Recovery capsules must be written in vault order before session sealing.
        await this.recoveryStore.writeCapsule(record);
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        next.push({ vaultId: entry.vaultId, status: "recovered" });
      } catch {
        failed = true;
        // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
        next.push({
          vaultId: entry.vaultId,
          status: "failed",
          code: "VAULT_SESSION_RECOVERY_FAILED",
        });
      }
    }
    return { failed, vaults: next };
  }

  async _enableIngress() {
    if (!this.httpIngress) {
      return;
    }
    const enable = this.httpIngress.enableSensitive || this.httpIngress.enable;
    if (typeof enable === "function") {
      await enable.call(this.httpIngress);
    }
  }

  async _disableIngress() {
    if (!this.httpIngress) {
      return;
    }
    const disable =
      this.httpIngress.disableSensitive || this.httpIngress.disable;
    if (typeof disable === "function") {
      await disable.call(this.httpIngress);
    }
  }

  async _hasDestructionTombstone() {
    return Boolean(
      this.recoveryStore &&
      typeof this.recoveryStore.hasDestructionTombstone === "function" &&
      (await this.recoveryStore.hasDestructionTombstone())
    );
  }

  _upgradeCloseReason(reason) {
    if (CLOSE_PRIORITY[reason] > CLOSE_PRIORITY[this._closeReason]) {
      this._closeReason = reason;
      this._reason = reason;
      this._abortLeases();
    }
  }

  _beginTransition(state, reason) {
    this._transitionId += 1;
    this._setState(state, reason);
  }

  _setState(state, reason) {
    this._state = state;
    this._reason = reason;
    if (!this.onStateChange) {
      return;
    }
    const snapshot = this.snapshot();
    queueMicrotask(() => {
      try {
        this.onStateChange(snapshot);
      } catch {
        // State observers must not interrupt session transitions.
      }
    });
  }

  _trackTransition(kind, promise) {
    this._transitionKind = kind;
    this._transitionPromise = promise;
  }

  _clearTransition(promise) {
    if (this._transitionPromise !== promise) {
      return;
    }
    this._transitionPromise = null;
    this._transitionKind = null;
  }

  _getActiveVaultId() {
    if (typeof this.vaultManager.getActiveVaultId === "function") {
      return this.vaultManager.getActiveVaultId();
    }
    return (
      this._vaults.find((entry) => entry.status === "active")?.vaultId ??
      "system"
    );
  }

  _errorForState() {
    const code =
      STATE_ERROR_CODES[this._state] || "VAULT_SESSION_TRANSITION_IN_PROGRESS";
    return sessionError(code, `Vault session is ${this._state}`);
  }

  _openResult(outcome, provisioned) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return immutableCopy({
      state: this._state,
      outcome,
      transitionId: this._transitionId,
      provisioned,
      vaults: this._vaults,
      warnings: this._warnings,
    });
  }

  _closeResult(outcome, reason, vaults) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return immutableCopy({
      state: this._state,
      outcome,
      reason,
      transitionId: this._transitionId,
      vaults,
      warnings: this._warnings,
    });
  }

  _destroyResult(outcome, artifacts) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return immutableCopy({
      state: this._state,
      outcome,
      transitionId: this._transitionId,
      artifacts,
    });
  }

  _recordWarning(code) {
    if (!this._warnings.some((warning) => warning.code === code)) {
      this._warnings.push({ code });
    }
  }

  _logFinalShutdownRecord() {
    if (!this.logger) {
      return;
    }
    const log = this.logger.logLock || this.logger.logApp || this.logger.log;
    if (typeof log === "function") {
      try {
        log.call(
          this.logger,
          `Vault session ${this._transitionId} closing for quit`
        );
      } catch {
        // Logging failure must not prevent shutdown.
      }
    }
  }
}

VaultSession.Error = VaultSessionError;
module.exports = VaultSession;
