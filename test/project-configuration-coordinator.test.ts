"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");
const ProjectConfigurationCoordinator = require("../src/modules/project-configuration-coordinator");

const targetCache = new WeakMap<
  object,
  Map<string, { projectName: string; environmentId: string }>
>();

const defaultTarget = (
  vault: {
    resolveEnvironmentTarget: (selector: { projectName: string }) => {
      projectName: string;
      environmentId: string;
    };
  },
  projectName: string
) => {
  let projects = targetCache.get(vault);
  if (!projects) {
    projects = new Map();
    targetCache.set(vault, projects);
  }
  let target = projects.get(projectName);
  if (!target) {
    target = vault.resolveEnvironmentTarget({ projectName });
    projects.set(projectName, target);
  }
  return target;
};

const PASSWORD = "configuration-completeness-integration-password";

const createRuntime = (directory) => {
  const recoveryStore = new VaultRecoveryStore(
    path.join(directory, "recovery")
  );
  const vaultManager = new VaultManager(directory, { recoveryStore });
  vaultManager.init();
  const session = new VaultSession({
    httpIngress: { disableSensitive() {}, enableSensitive() {} },
    logger: { clearEncryptionKey() {}, setEncryptionKey() {} },
    recoveryStore,
    settingsProvider: () => ({ autoLockEnabled: false, diskSyncIntervalMs: 0 }),
    vaultManager,
  });
  return { session };
};

const setup = async (
  t,
  options: {
    secrets?: Record<string, { value: string; expiresAt?: string | null }>;
    requiredKeys?: string[];
    now?: () => Date;
  } = {}
) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-configuration-coordinator-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(async ({ activeVault }) => {
    await activeVault.createProject("service");
    const target = defaultTarget(activeVault, "service");
    if (options.secrets) {
      for (const [key, secret] of Object.entries(options.secrets)) {
        activeVault.setSecret(
          target,
          key,
          secret.value,
          secret.expiresAt ?? null
        );
      }
    }
    if (options.requiredKeys) {
      await activeVault.replaceProjectConfigurationBaseline(
        target,
        options.requiredKeys
      );
    }
  });
  const coordinator = new ProjectConfigurationCoordinator({
    now: options.now || (() => new Date("2030-01-01T00:00:00.000Z")),
    session,
  });
  // The coordinator only accepts an explicit Project + Environment target.
  const target = await session.withActiveSession(({ activeVault }) =>
    activeVault.resolveEnvironmentTarget({ projectName: "service" })
  );
  return { coordinator, session, target };
};

test("Project completeness distinguishes no baseline from an evaluated baseline", async (t) => {
  const { session, coordinator, target } = await setup(t, {});

  const absent = await coordinator.get({
    environmentId: "env-missing",
    projectName: "missing",
  });
  assert.equal(absent.success, false);
  assert.equal(absent.code, "CONFIGURATION_TARGET_UNAVAILABLE");

  const notConfigured = await coordinator.get(target);
  assert.deepEqual(
    {
      configured: notConfigured.configured,
      target: notConfigured.target.projectName,
    },
    {
      configured: false,
      target: "service",
    }
  );

  await session.withActiveSession(({ activeVault }) => {
    activeVault.setSecret(target, "EMPTY", "");
    activeVault.setSecret(target, "EXPIRED", "old", "2030-01-01T00:00:00.000Z");
    activeVault.setSecret(target, "READY", "present");
    activeVault.setSecret(target, "WHITESPACE", "   ");
    activeVault.setSecret(target, "constructor", "own");
    activeVault.setSecret(target, "__proto__", "own");
    activeVault.setSecret(target, "casesensitive", "wrong case");
    activeVault.setSecret(target, "EXTRA", "unrelated");
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.replaceProjectConfigurationBaseline(target, [
      "EMPTY",
      "EXPIRED",
      "READY",
      "WHITESPACE",
      "constructor",
      "__proto__",
      "CaseSensitive",
    ])
  );

  const result = await coordinator.get(target);
  assert.equal(result.configured, true);
  assert.deepEqual(result.counts, {
    empty: 1,
    expired: 1,
    missing: 1,
    ready: 4,
    required: 7,
  });
  assert.deepEqual(
    result.entries.map(({ key, status }) => [key, status]),
    [
      ["CaseSensitive", "Missing"],
      ["EMPTY", "Empty"],
      ["EXPIRED", "Expired"],
      ["READY", "Ready"],
      ["WHITESPACE", "Ready"],
      ["__proto__", "Ready"],
      ["constructor", "Ready"],
    ]
  );
  assert.equal(result.evaluatedAt, "2030-01-01T00:00:00.000Z");
  assert.equal(result.nextExpiry, null);
  assert.equal(JSON.stringify(result).includes("present"), false);
  assert.equal(JSON.stringify(result).includes("unrelated"), false);
  await session.close({ reason: "manual" });
});

test("template review collapses names, strips values, and reports a safe refresh diff", async (t) => {
  const { session, coordinator, target } = await setup(t, {
    requiredKeys: ["COMMON", "REMOVED"],
    secrets: {
      COMMON: { value: "existing-secret" },
      REMOVED: { value: "removed-secret" },
    },
  });
  const source =
    "COMMON=private-example\nNEW=another-private-example\nNEW=third-private-example\n";
  const preview = await coordinator.preview(target, {
    content: source,
    source: "text",
  });

  assert.equal(preview.success, true);
  assert.deepEqual(preview.changes, {
    added: ["NEW"],
    removed: ["REMOVED"],
    unchanged: ["COMMON"],
  });
  assert.equal(preview.duplicateNames, 1);
  assert.deepEqual(preview.entries, [
    { key: "COMMON", status: "Ready" },
    { key: "NEW", status: "Missing" },
  ]);
  assert.equal(JSON.stringify(preview).includes("private-example"), false);
  assert.equal(JSON.stringify(preview).includes("existing-secret"), false);

  const filePath = path.join(
    os.tmpdir(),
    `keyharbor-template-${process.pid}.env`
  );
  fs.writeFileSync(filePath, source, "utf-8");
  t.after(() => fs.rmSync(filePath, { force: true }));
  const fromFile = await coordinator.preview(target, {
    filePath,
    source: "file",
  });
  assert.equal(fromFile.success, true);
  assert.deepEqual(fromFile.entries, preview.entries);
  assert.deepEqual(fromFile.changes, preview.changes);
  assert.equal(JSON.stringify(fromFile).includes(filePath), false);
  await coordinator.discard(preview.handle);
  await coordinator.discard(fromFile.handle);
  await session.close({ reason: "manual" });
});

test("malformed and empty templates block review without echoing source values", async (t) => {
  const { session, coordinator, target } = await setup(t);
  for (const [content, code] of [
    ["TOKEN=do-not-echo\nunsupported prose", "invalid_assignment"],
    ["# no keys", "empty_input"],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
    const result = await coordinator.preview(target, {
      content,
      source: "text",
    });
    assert.equal(result.success, true);
    assert.equal(result.handle, null);
    assert.equal(result.diagnostics[0].code, code);
    assert.equal(JSON.stringify(result).includes("do-not-echo"), false);
  }
  const awaitedResult1 = await coordinator.get(target);
  assert.equal(awaitedResult1.configured, false);
  await session.close({ reason: "manual" });
});

test("first setup review evaluates current Secrets for every candidate key", async (t) => {
  const { session, coordinator, target } = await setup(t, {
    secrets: {
      EMPTY: { value: "" },
      EXPIRED: { expiresAt: "2029-12-31T23:59:59.000Z", value: "old" },
      READY: { value: "present" },
    },
  });
  const preview = await coordinator.preview(target, {
    content: "READY=example\nEMPTY=\nEXPIRED=example\nMISSING=example\n",
    source: "text",
  });
  assert.deepEqual(preview.entries, [
    { key: "EMPTY", status: "Empty" },
    { key: "EXPIRED", status: "Expired" },
    { key: "MISSING", status: "Missing" },
    { key: "READY", status: "Ready" },
  ]);
  await coordinator.discard(preview.handle);
  await session.close({ reason: "manual" });
});

test("preview commit replaces only the baseline, preserves Secrets, and treats equal sets as a no-op", async (t) => {
  const { session, coordinator, target } = await setup(t, {
    requiredKeys: ["OLD"],
    secrets: { EXTRA: { value: "untouched" }, OLD: { value: "keep-me" } },
  });
  const preview = await coordinator.preview(target, {
    content: "NEW=example-value\n",
    source: "text",
  });
  const committed = await coordinator.commit(preview.handle);
  assert.deepEqual(committed, {
    addedCount: 1,
    changed: true,
    kind: "replace",
    removedCount: 1,
    requiredCount: 1,
    success: true,
    unchangedCount: 0,
  });
  const first = await session.withActiveSession(({ activeVault }) =>
    activeVault.getProjectConfigurationBaseline(
      defaultTarget(activeVault, "service")
    )
  );
  assert.deepEqual(first.configurationBaseline.requiredKeys, ["NEW"]);
  const awaitedResult2 = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "OLD")
  );
  assert.equal(awaitedResult2.value, "keep-me");
  const awaitedResult3 = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "EXTRA")
  );
  assert.equal(awaitedResult3.value, "untouched");

  const repeated = await coordinator.preview(target, {
    content: "NEW=other-example\n",
    source: "text",
  });
  assert.deepEqual(repeated.changes, {
    added: [],
    removed: [],
    unchanged: ["NEW"],
  });
  assert.deepEqual(await coordinator.commit(repeated.handle), {
    addedCount: 0,
    changed: false,
    kind: "replace",
    removedCount: 0,
    requiredCount: 1,
    success: true,
    unchangedCount: 1,
  });
  const afterNoop = await session.withActiveSession(({ activeVault }) =>
    activeVault.getProjectConfigurationBaseline(
      defaultTarget(activeVault, "service")
    )
  );
  assert.deepEqual(
    afterNoop.configurationBaseline,
    first.configurationBaseline
  );

  const clearReview = await coordinator.previewClear(target);
  assert.deepEqual(clearReview.removed, ["NEW"]);
  assert.equal(clearReview.secretsRemain, true);
  assert.deepEqual(await coordinator.commit(clearReview.handle), {
    addedCount: 0,
    changed: true,
    kind: "clear",
    removedCount: 1,
    requiredCount: 0,
    success: true,
    unchangedCount: 0,
  });
  const awaitedResult4 = await coordinator.get(target);
  assert.equal(awaitedResult4.configured, false);
  assert.equal(
    Object.hasOwn(
      await session.withActiveSession(({ activeVault }) =>
        activeVault.getSecrets(target)
      ),
      "NEW"
    ),
    false
  );
  const awaitedResult5 = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "OLD")
  );
  assert.equal(awaitedResult5.value, "keep-me");
  await session.close({ reason: "manual" });
});

test("commits reject a changed baseline but allow unrelated Secret edits", async (t) => {
  const { session, coordinator, target } = await setup(t, {
    requiredKeys: ["OLD"],
  });
  const unrelated = await coordinator.preview(target, {
    content: "NEW=example",
    source: "text",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(target, "UNRELATED", "retained")
  );
  const awaitedResult6 = await coordinator.commit(unrelated.handle);
  assert.equal(awaitedResult6.success, true);

  const stale = await coordinator.preview(target, {
    content: "STALE=example",
    source: "text",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.replaceProjectConfigurationBaseline(target, ["CONCURRENT"])
  );
  const rejected = await coordinator.commit(stale.handle);
  assert.equal(rejected.code, "CONFIGURATION_STALE");
  assert.equal(JSON.stringify(rejected).includes("example"), false);
  const awaitedResult7 = await coordinator.commit(stale.handle);
  assert.equal(awaitedResult7.code, "CONFIGURATION_PREVIEW_INVALID");
  await session.close({ reason: "manual" });
});

test("the evaluation boundary handles expiry immediately before, at, and after its deadline", async (t) => {
  const { session, coordinator, target } = await setup(t, {
    now: () => new Date("2030-01-01T00:00:00.000Z"),
    requiredKeys: ["BEFORE", "AT", "AFTER", "FUTURE"],
    secrets: {
      AFTER: { expiresAt: "2030-01-01T00:00:00.001Z", value: "c" },
      AT: { expiresAt: "2030-01-01T00:00:00.000Z", value: "b" },
      BEFORE: { expiresAt: "2029-12-31T23:59:59.999Z", value: "a" },
      FUTURE: { expiresAt: "2030-01-01T00:00:01.000Z", value: "d" },
    },
  });
  const result = await coordinator.get(target);
  assert.deepEqual(result.counts, {
    empty: 0,
    expired: 2,
    missing: 0,
    ready: 2,
    required: 4,
  });
  assert.equal(result.nextExpiry, "2030-01-01T00:00:00.001Z");
  await session.close({ reason: "manual" });
});

test("invalid expiry metadata fails evaluation without exposing the stored value", async (t) => {
  const { session, coordinator, target } = await setup(t, {
    requiredKeys: ["BAD"],
    secrets: { BAD: { expiresAt: "not-a-timestamp", value: "private-secret" } },
  });
  const result = await coordinator.get(target);
  assert.equal(result.success, false);
  assert.equal(result.code, "CONFIGURATION_EVALUATION_FAILED");
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
  await session.close({ reason: "manual" });
});

test("clear invalidates a commit while its guarded write is waiting in the Vault queue", async (t) => {
  const { session, coordinator, target } = await setup(t);
  const preview = await coordinator.preview(target, {
    content: "QUEUED=value",
    source: "text",
  });
  const originalWriteFile = fs.promises.writeFile;
  let started;
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  const writeStarted = new Promise((resolve) => {
    started = resolve;
  });
  let release;
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  const writeGate = new Promise((resolve) => {
    release = resolve;
  });
  let pauseNextVaultWrite = true;
  fs.promises.writeFile = async (...args) => {
    if (pauseNextVaultWrite && String(args[0]).includes("vault-v2.enc.")) {
      pauseNextVaultWrite = false;
      started();
      await writeGate;
    }
    return originalWriteFile(...args);
  };
  t.after(() => {
    fs.promises.writeFile = originalWriteFile;
  });

  const save = session.withActiveSession(({ activeVault }) =>
    activeVault.saveNow()
  );
  await writeStarted;
  const commit = coordinator.commit(preview.handle);
  const afterSave = session.withActiveSession(({ activeVault }) =>
    activeVault.saveNow()
  );
  coordinator.clear();
  release();
  await save;
  const result = await commit;
  await afterSave;
  assert.equal(result.code, "CONFIGURATION_PREVIEW_INVALID");
  const awaitedResult8 = await session.withActiveSession(({ activeVault }) =>
    activeVault.getProjectConfigurationBaseline(
      defaultTarget(activeVault, "service")
    )
  );
  assert.equal(awaitedResult8.configurationBaseline, null);
  await session.close({ reason: "manual" });
});
