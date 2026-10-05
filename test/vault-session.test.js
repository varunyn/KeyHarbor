const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate: nextTurn } = require("node:timers/promises");
const VaultSession = require("../src/modules/vault-session");

const deferred = () => {
  let settle;
  let fail;
  // A manually settled gate exercises cancellation and lease-drain ordering.
  // eslint-disable-next-line promise/avoid-new
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, reject: fail, resolve: settle };
};

const createHarness = (options = {}) => {
  const events = [];
  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  let tombstone = false;
  const context = {
    activeVault: { getProjects: () => ["project"] },
    security: {},
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    vaults: { syncAll: async () => calls.push("sync") },
  };
  const manager = {
    activeVaultId: "system",
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async changeSystemPassword() {
      calls.push("password:rotate");
      return { rotated: true };
    },
    copySystemKey() {
      calls.push("key:copy");
      return Buffer.alloc(32, 9);
    },
    createSessionContext(signal) {
      return { ...context, signal };
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async destroySession() {
      calls.push("destroy");
      return options.destroy
        ? options.destroy()
        : {
            artifacts: [
              { kind: "vault", status: "deleted" },
              { kind: "salt", status: "deleted" },
            ],
          };
    },
    getActiveVaultId() {
      return this.activeVaultId;
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async getRecoveryRecord(vaultId) {
      return { encryptedInternalRecord: true, vaultId };
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async openSession(request) {
      calls.push(`open:${request.method}`);
      if (options.open) {
        return options.open(request);
      }
      return {
        createContext: (signal) => ({ ...context, signal }),
        loggerKey: Buffer.alloc(32, 7),
        provisioned: request.method === "setup",
        vaults: [{ status: "active", vaultId: "system" }],
      };
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async prepareClose(request) {
      calls.push(`prepare:${request.reason}`);
      return options.prepare
        ? options.prepare(request)
        : { vaults: [{ status: "persisted", vaultId: "system" }] };
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async resetSession() {
      calls.push("reset");
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async resolveRecovery(request) {
      calls.push(`recover:${request.decision}`);
      if (options.resolveRecovery) {
        return options.resolveRecovery(request);
      }
      return {
        loggerKey: Buffer.alloc(32, 8),
        recovery: [],
        vaults: [{ status: "active", vaultId: "system" }],
      };
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async rollbackOpen() {
      calls.push("rollback");
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async sealSession() {
      calls.push("seal");
    },
  };
  const logger = {
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async clearEncryptionKey() {
      calls.push("logger:clear");
    },
    logLock(message) {
      calls.push(`log:${message}`);
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async setEncryptionKey() {
      calls.push("logger:set");
    },
  };
  const ingress = {
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async disableSensitive() {
      calls.push("ingress:off");
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async enableSensitive() {
      calls.push("ingress:on");
    },
  };
  const scheduler = {
    clearInterval(id) {
      timers.delete(id);
    },
    getIdleTimeSeconds() {
      return this.idleSeconds;
    },
    idleSeconds: 0,
    setInterval(callback, milliseconds) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { callback, milliseconds });
      return id;
    },
  };
  const recoveryStore = {
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async beginDestruction() {
      tombstone = true;
      calls.push("tombstone:begin");
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async enumerate() {
      return [];
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async finishDestruction() {
      tombstone = false;
      calls.push("tombstone:end");
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async hasDestructionTombstone() {
      return tombstone;
    },
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    async writeCapsule(record) {
      calls.push(`capsule:${record.vaultId}`);
      if (options.capsuleError) {
        throw new Error("capsule failed");
      }
    },
  };
  const session = new VaultSession({
    httpIngress: ingress,
    logger,
    monitorScheduler: scheduler,
    onStateChange: (snapshot) => events.push(snapshot),
    recoveryStore,
    securityCoordinator: {
      // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
      // eslint-disable-next-line require-await
      async afterKeyRotation(key) {
        assert.equal(key.equals(Buffer.alloc(32, 9)), true);
        calls.push("security:rotated");
      },
    },
    vaultManager: manager,
  });

  return {
    calls,
    context,
    events,
    ingress,
    logger,
    manager,
    recoveryStore,
    scheduler,
    session,
    timers,
  };
};

// Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
// eslint-disable-next-line require-await
const openActive = async (harness, method = "password") =>
  harness.session.open({
    credential: method === "key" ? Buffer.alloc(32, 1) : "password",
    method,
    reason: method === "setup" ? "setup" : "manual",
  });

test("open activates one sanitized immutable session snapshot", async () => {
  const harness = createHarness();
  const result = await openActive(harness);

  assert.equal(result.state, "active");
  assert.equal(result.outcome, "opened");
  assert.deepEqual(result.vaults, [{ status: "active", vaultId: "system" }]);
  assert.equal(harness.session.snapshot().activeVaultId, "system");
  assert.equal(Object.isFrozen(harness.session.snapshot()), true);
  assert.deepEqual(
    harness.events.map((event) => event.state),
    ["opening", "active"]
  );
  assert.ok(
    harness.calls.indexOf("logger:set") < harness.calls.indexOf("ingress:on")
  );
});

test("all open methods converge and setup reports durable provisioning", async () => {
  for (const method of ["setup", "password", "key"]) {
    const harness = createHarness();
    // Run lifecycle cases sequentially so each transition and its assertions finish before the next case.
    // eslint-disable-next-line no-await-in-loop
    const result = await openActive(harness, method);
    assert.equal(result.state, "active");
    assert.equal(result.provisioned, method === "setup");
  }
});

test("a second open is rejected without coalescing credentials", async () => {
  const gate = deferred();
  // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
  // eslint-disable-next-line require-await
  const harness = createHarness({ open: async () => gate.promise });
  const first = harness.session.open({
    credential: "first",
    method: "password",
    reason: "manual",
  });

  await assert.rejects(
    harness.session.open({
      credential: "second",
      method: "password",
      reason: "manual",
    }),
    (failure) => failure.code === "VAULT_SESSION_TRANSITION_IN_PROGRESS"
  );
  gate.resolve({
    loggerKey: Buffer.alloc(32),
    vaults: [{ status: "active", vaultId: "system" }],
  });
  await first;
});

test("state observers may re-enter and cancel an opening transition", async () => {
  const gate = deferred();
  // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
  // eslint-disable-next-line require-await
  const harness = createHarness({ open: async () => gate.promise });
  let closePromise;
  harness.session.onStateChange = (snapshot) => {
    if (snapshot.state === "opening" && !closePromise) {
      closePromise = harness.session.close({ reason: "manual" });
    }
  };

  const opening = harness.session.open({
    credential: "password",
    method: "password",
    reason: "manual",
  });
  await Promise.resolve();
  gate.resolve({
    loggerKey: Buffer.alloc(32),
    vaults: [{ status: "active", vaultId: "system" }],
  });

  await assert.rejects(
    opening,
    (failure) => failure.code === "VAULT_SESSION_OPEN_FAILED"
  );
  const closed = await closePromise;
  assert.equal(closed.outcome, "already_locked");
});

test("failed setup rolls back runtime and preserves provisioned detail", async () => {
  const harness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    open: async () => {
      const error = new Error("activation failed");
      error.provisioned = true;
      throw error;
    },
  });
  // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
  // eslint-disable-next-line require-await
  harness.manager.openSession = async () => {
    harness.calls.push("open:setup");
    const error = new VaultSession.Error(
      "VAULT_SESSION_OPEN_FAILED",
      "activation failed",
      { provisioned: true }
    );
    throw error;
  };

  await assert.rejects(
    harness.session.open({
      credential: "password",
      method: "setup",
      reason: "setup",
    }),

    (failure) =>
      failure.code === "VAULT_SESSION_OPEN_FAILED" &&
      failure.details.provisioned === true
  );
  assert.equal(harness.session.snapshot().state, "locked");
  assert.ok(harness.calls.includes("rollback"));
});

test("withActiveSession provides a cancellable facade lease and state-specific errors", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.session.withActiveSession(() => {}),
    (failure) => failure.code === "VAULT_SESSION_LOCKED"
  );
  await openActive(harness);

  const value = await harness.session.withActiveSession(
    ({ activeVault, signal }) => {
      assert.equal(signal.aborted, false);
      return activeVault.getProjects();
    }
  );
  assert.deepEqual(value, ["project"]);
});

test("password rotation coordinates the manager, logger key, and security adapter inside a lease", async () => {
  const harness = createHarness();
  await openActive(harness);

  const result = await harness.session.withActiveSession(({ security }) =>
    security.changePassword("old", "new")
  );

  assert.deepEqual(result, { rotated: true });
  assert.ok(
    harness.calls.indexOf("password:rotate") < harness.calls.indexOf("key:copy")
  );
  assert.ok(
    harness.calls.indexOf("key:copy") < harness.calls.lastIndexOf("logger:set")
  );
  assert.ok(
    harness.calls.indexOf("key:copy") <
      harness.calls.indexOf("security:rotated")
  );
});

test("manual close drains leases before preparing and sealing", async () => {
  const harness = createHarness();
  await openActive(harness);
  const work = deferred();
  // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
  // eslint-disable-next-line require-await
  const operation = harness.session.withActiveSession(async ({ signal }) => {
    signal.addEventListener("abort", () => work.resolve("cancelled"), {
      once: true,
    });
    return work.promise;
  });

  const result = await harness.session.close({
    deadlineMs: 100,
    reason: "manual",
  });
  await operation;
  assert.equal(result.outcome, "closed");
  assert.equal(result.state, "locked");
  assert.ok(
    harness.calls.indexOf("prepare:manual") < harness.calls.indexOf("seal")
  );
});

test("manual persistence conflict restores the active runtime", async () => {
  const harness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    prepare: async () => ({
      vaults: [{ status: "needs_resolution", vaultId: "system" }],
    }),
  });
  await openActive(harness);

  const result = await harness.session.close({ reason: "manual" });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.state, "active");
  assert.equal(harness.session.snapshot().state, "active");
  assert.equal(harness.calls.includes("seal"), false);
});

test("manager configuration persistence participates in close policy and recovery", async () => {
  const manualHarness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    prepare: async () => ({
      config: { code: "VAULT_CONFIG_EXTERNAL_CHANGE", status: "failed" },
      vaults: [],
    }),
  });
  await openActive(manualHarness);

  const manual = await manualHarness.session.close({ reason: "manual" });
  assert.equal(manual.outcome, "blocked");
  assert.deepEqual(manual.vaults, [
    {
      code: "VAULT_CONFIG_EXTERNAL_CHANGE",
      status: "failed",
      vaultId: "manager_config",
    },
  ]);
  assert.equal(manualHarness.session.snapshot().state, "active");

  const quitHarness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    prepare: async () => ({
      config: { code: "VAULT_CONFIG_EXTERNAL_CHANGE", status: "failed" },
      vaults: [],
    }),
  });
  await openActive(quitHarness);

  const quit = await quitHarness.session.close({ reason: "quit" });
  assert.equal(quit.outcome, "closed");
  assert.deepEqual(quit.vaults, [
    { status: "recovered", vaultId: "manager_config" },
  ]);
  assert.ok(quitHarness.calls.includes("capsule:manager_config"));
});

test("manual drain timeout never prepares or seals a live lease", async () => {
  const harness = createHarness();
  await openActive(harness);
  const work = deferred();
  const operation = harness.session.withActiveSession(() => work.promise);

  const result = await harness.session.close({
    deadlineMs: 1,
    reason: "manual",
  });

  assert.equal(result.outcome, "drain_timeout");
  assert.equal(result.state, "active");
  assert.equal(
    harness.calls.some((call) => call.startsWith("prepare:")),
    false
  );
  assert.equal(harness.calls.includes("seal"), false);
  work.resolve();
  await operation;
});

test("quit upgrades an in-progress manual close", async () => {
  const harness = createHarness();
  await openActive(harness);
  const work = deferred();
  const operation = harness.session.withActiveSession(({ signal }) => {
    signal.addEventListener("abort", () => work.resolve(), { once: true });
    return work.promise;
  });

  const manual = harness.session.close({ deadlineMs: 100, reason: "manual" });
  const quit = harness.session.close({ deadlineMs: 100, reason: "quit" });
  const [manualResult, quitResult] = await Promise.all([manual, quit]);
  await operation;

  assert.equal(manualResult.reason, "quit");
  assert.deepEqual(manualResult, quitResult);
  assert.ok(harness.calls.includes("prepare:quit"));
});

test("quit upgrade during persistence controls the final close policy", async () => {
  const prepareStarted = deferred();
  const finishPrepare = deferred();
  const harness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    prepare: async () => {
      prepareStarted.resolve();
      return finishPrepare.promise;
    },
  });
  await openActive(harness);

  const manual = harness.session.close({ reason: "manual" });
  await prepareStarted.promise;
  const quit = harness.session.close({ reason: "quit" });
  finishPrepare.resolve({
    vaults: [{ code: "IO_ERROR", status: "failed", vaultId: "system" }],
  });

  const [manualResult, quitResult] = await Promise.all([manual, quit]);
  assert.equal(manualResult.reason, "quit");
  assert.equal(manualResult.outcome, "closed");
  assert.deepEqual(manualResult, quitResult);
  assert.ok(harness.calls.includes("capsule:system"));
  assert.equal(harness.session.snapshot().state, "locked");
});

test("security close writes recovery capsules and reports failure safely", async () => {
  const harness = createHarness({
    capsuleError: true,
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    prepare: async () => ({
      vaults: [
        {
          code: "IO_ERROR",
          secret: "hidden",
          status: "failed",
          vaultId: "system",
        },
      ],
    }),
  });
  await openActive(harness);

  const result = await harness.session.close({ reason: "quit" });

  assert.equal(result.state, "locked");
  assert.equal(result.outcome, "recovery_failed");
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.ok(harness.calls.includes("seal"));
});

test("recovery restricts ordinary work until its decision activates the session", async () => {
  const harness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    open: async () => ({
      recovery: [
        {
          allowedDecisions: ["keep_recovered", "discard"],
          artifactId: "system",
          capsuleId: "capsule-1",
          kind: "vault",
          payload: "secret",
          reason: "disk_changed",
        },
      ],
      state: "recovering",
      vaults: [{ status: "recovery_required", vaultId: "system" }],
    }),
  });
  const opened = await openActive(harness);
  assert.equal(opened.state, "recovering");
  assert.equal(
    JSON.stringify(harness.session.snapshot()).includes("secret"),
    false
  );
  await assert.rejects(
    harness.session.withActiveSession(() => {}),
    (failure) => failure.code === "VAULT_SESSION_RECOVERING"
  );

  const resolved = await harness.session.resolveRecovery({
    artifactId: "system",
    capsuleId: "capsule-1",
    decision: "keep_recovered",
    kind: "vault",
  });
  assert.equal(resolved.state, "active");
  assert.ok(harness.calls.includes("logger:set"));
});

test("configure replaces monitor generations and stale callbacks are harmless", async () => {
  const harness = createHarness();
  await harness.session.configure({
    autoLockEnabled: true,
    autoLockTimeoutSeconds: 30,
    diskSyncIntervalMs: 5000,
  });
  await openActive(harness);
  const oldCallbacks = [...harness.timers.values()].map(
    (timer) => timer.callback
  );

  await harness.session.configure({
    autoLockEnabled: false,
    autoLockTimeoutSeconds: 30,
    diskSyncIntervalMs: 6000,
  });
  assert.equal(harness.timers.size, 1);
  for (const monitorCallback of oldCallbacks) {
    monitorCallback();
  }
  await Promise.resolve();
  assert.equal(harness.session.snapshot().state, "active");
});

test("auto-lock callback does not wait on itself while closing", async () => {
  const harness = createHarness();
  await harness.session.configure({
    autoLockEnabled: true,
    autoLockTimeoutSeconds: 1,
    diskSyncIntervalMs: 0,
  });
  await openActive(harness);
  harness.scheduler.idleSeconds = 2;
  const [timer] = [...harness.timers.values()];
  const { callback: monitorCallback } = timer;

  monitorCallback();
  await nextTurn();

  assert.equal(harness.session.snapshot().state, "locked");
  assert.ok(harness.calls.includes("prepare:idle"));
});

test("destroy requires confirmation, writes a tombstone, seals, and returns safe artifact results", async () => {
  const harness = createHarness();
  await openActive(harness);
  await assert.rejects(
    harness.session.destroy({ confirmation: "DELETE" }),
    TypeError
  );

  const result = await harness.session.destroy({ confirmation: "delete" });

  assert.equal(result.state, "locked");
  assert.equal(result.outcome, "destroyed");
  assert.deepEqual(result.artifacts, [
    { kind: "vault", status: "deleted" },
    { kind: "salt", status: "deleted" },
  ]);
  assert.ok(
    harness.calls.indexOf("tombstone:begin") < harness.calls.indexOf("seal")
  );
  assert.ok(harness.calls.indexOf("seal") < harness.calls.indexOf("destroy"));
  assert.ok(harness.calls.includes("tombstone:end"));
});

test("destroy during recovery explicitly discards recovery and destroys the session", async () => {
  const harness = createHarness({
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    open: async () => ({
      recovery: [
        {
          allowedDecisions: ["keep_recovered", "discard"],
          artifactId: "system",
          capsuleId: "capsule-1",
          kind: "vault",
          reason: "disk_changed",
        },
      ],
      state: "recovering",
      vaults: [{ status: "recovery_required", vaultId: "system" }],
    }),
  });
  await openActive(harness);

  const result = await harness.session.destroy({ confirmation: "delete" });

  assert.equal(result.outcome, "destroyed");
  assert.equal(harness.session.snapshot().state, "locked");
  assert.ok(harness.calls.includes("tombstone:begin"));
  assert.ok(harness.calls.includes("destroy"));
});
