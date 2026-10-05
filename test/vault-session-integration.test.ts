const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");
const CryptoUtil = require("../src/modules/crypto");

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

const PASSWORD = "vault-session-integration-password";

const createRuntime = (directory) => {
  const recoveryStore = new VaultRecoveryStore(
    path.join(directory, "recovery")
  );
  const vaultManager = new VaultManager(directory, { recoveryStore });
  vaultManager.init();
  const session = new VaultSession({
    httpIngress: {
      disableSensitive() {},
      enableSensitive() {},
    },
    logger: {
      clearEncryptionKey() {},
      setEncryptionKey() {},
    },
    recoveryStore,
    settingsProvider: () => ({ autoLockEnabled: false, diskSyncIntervalMs: 0 }),
    vaultManager,
  });
  return { session, vaultManager };
};

test("real session setup, mutation, close, and password reopen preserve Vault data", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-session-integration-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const first = createRuntime(directory);
  const opened = await first.session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  assert.equal(opened.outcome, "opened");
  assert.equal(opened.provisioned, true);

  // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
  // eslint-disable-next-line require-await
  await first.session.withActiveSession(async ({ activeVault }) => {
    activeVault.createProject("integration");
    activeVault.setSecret(
      defaultTarget(activeVault, "integration"),
      "token",
      "persisted-value"
    );
  });
  const closed = await first.session.close({ reason: "manual" });
  assert.equal(closed.outcome, "closed");
  assert.equal(first.vaultManager.systemVault, null);

  const second = createRuntime(directory);
  const reopened = await second.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  assert.equal(reopened.outcome, "opened");
  const secret = await second.session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(defaultTarget(activeVault, "integration"), "token")
  );
  assert.equal(secret.value, "persisted-value");
  await second.session.close({ reason: "manual" });
});

test("real session keeps Environment secret collections isolated and resolves the fixed default", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-environment-session-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const runtime = createRuntime(directory);
  await runtime.session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await runtime.session.withActiveSession(({ activeVault }) => {
    activeVault.createProject("application");
    const environments = activeVault.getEnvironments("application");
    assert.equal(environments.length, 1);
    assert.equal(environments[0].name, "default");

    activeVault.setSecret(
      defaultTarget(activeVault, "application"),
      "DATABASE_URL",
      "default-db"
    );
    const dev = activeVault.createEnvironment("application", "dev");
    activeVault.setSecret(
      { environmentId: dev.id, projectName: "application" },
      "DATABASE_URL",
      "dev-db"
    );

    assert.equal(
      activeVault.getSecret(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ).value,
      "default-db"
    );
    assert.equal(
      activeVault.getSecret(
        { environmentId: dev.id, projectName: "application" },
        "DATABASE_URL"
      ).value,
      "dev-db"
    );
    assert.deepEqual(
      activeVault.resolveEnvironmentTarget({
        environmentName: "dev",
        projectName: "application",
      }),
      {
        environmentId: dev.id,
        projectName: "application",
      }
    );
    assert.equal(
      activeVault.getEnvironmentTargetIdentity({
        environmentId: dev.id,
        projectName: "application",
      }).environmentName,
      "dev"
    );
    assert.throws(
      () =>
        activeVault.getSecret(
          { environmentId: "missing", projectName: "application" },
          "DATABASE_URL"
        ),
      (failure) => failure.code === "ENVIRONMENT_NOT_FOUND"
    );
  });
  await runtime.session.close({ reason: "manual" });
});

test("Project configuration requirements persist through the public session boundary without changing Secrets", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-configuration-baseline-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const first = createRuntime(directory);
  await first.session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  let originalSecret;
  let originalHistory;
  let originalBaseline;
  await first.session.withActiveSession(async ({ activeVault }) => {
    activeVault.createProject("application");
    activeVault.setSecret(
      defaultTarget(activeVault, "application"),
      "DATABASE_URL",
      "synthetic-db",
      null,
      { description: "primary", tags: ["app"] }
    );
    activeVault.setSecret(
      defaultTarget(activeVault, "application"),
      "DATABASE_URL",
      "synthetic-db-rotated"
    );
    originalSecret = activeVault.getSecret(
      defaultTarget(activeVault, "application"),
      "DATABASE_URL"
    );
    originalHistory = activeVault.getSecretHistory(
      defaultTarget(activeVault, "application"),
      "DATABASE_URL"
    );

    const emptySnapshot = activeVault.getProjectConfigurationBaseline(
      defaultTarget(activeVault, "application")
    );
    assert.equal(emptySnapshot.exists, true);
    assert.match(emptySnapshot.incarnation, /^[a-f0-9]{32}$/u);
    assert.equal(emptySnapshot.configurationBaseline, null);
    await activeVault.replaceProjectConfigurationBaseline(
      defaultTarget(activeVault, "application"),
      ["ZED_KEY", "API_URL", "API_URL"]
    );
    const saved = activeVault.getProjectConfigurationBaseline(
      defaultTarget(activeVault, "application")
    );
    originalBaseline = saved.configurationBaseline;
    assert.deepEqual(saved.configurationBaseline.requiredKeys, [
      "API_URL",
      "ZED_KEY",
    ]);
    assert.match(saved.configurationBaseline.revision, /^[a-f0-9]{32}$/u);
    assert.equal(
      new Date(saved.configurationBaseline.updatedAt).toISOString(),
      saved.configurationBaseline.updatedAt
    );

    await activeVault.replaceProjectConfigurationBaseline(
      defaultTarget(activeVault, "application"),
      ["API_URL", "ZED_KEY"]
    );
    assert.deepEqual(
      activeVault.getProjectConfigurationBaseline(
        defaultTarget(activeVault, "application")
      ).configurationBaseline,
      originalBaseline
    );
    let targetValidated = false;
    await assert.rejects(
      activeVault.replaceProjectConfigurationBaseline(
        defaultTarget(activeVault, "application"),
        ["API_URL", "OTHER_KEY"],
        {
          baseline: { exists: false },
          incarnation: emptySnapshot.incarnation,
          validateTarget() {
            targetValidated = true;
          },
        }
      ),
      (failure) => failure.code === "CONFIGURATION_BASELINE_STALE"
    );
    assert.equal(targetValidated, true);
    assert.deepEqual(
      activeVault.getProjectConfigurationBaseline(
        defaultTarget(activeVault, "application")
      ).configurationBaseline,
      originalBaseline
    );
    assert.deepEqual(
      activeVault.getSecret(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalSecret
    );
    assert.deepEqual(
      activeVault.getSecretHistory(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalHistory
    );

    await assert.rejects(
      activeVault.replaceProjectConfigurationBaseline(
        defaultTarget(activeVault, "application"),
        []
      ),
      /at least one required key/iu
    );
    await assert.rejects(
      activeVault.replaceProjectConfigurationBaseline(
        defaultTarget(activeVault, "application"),
        ["bad-key"]
      ),
      /invalid required key/iu
    );
    await assert.rejects(
      activeVault.replaceProjectConfigurationBaseline(
        defaultTarget(activeVault, "application"),
        // A sparse array is the invalid input under test; filled arrays exercise a different case.
        // eslint-disable-next-line unicorn/no-new-array
        new Array(1)
      ),
      /invalid required key/iu
    );
    assert.deepEqual(
      activeVault.getProjectConfigurationBaseline(
        defaultTarget(activeVault, "application")
      ).configurationBaseline,
      originalBaseline
    );
    assert.deepEqual(
      activeVault.getSecret(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalSecret
    );
    assert.deepEqual(
      activeVault.getSecretHistory(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalHistory
    );

    const backup = first.vaultManager.copySystemKey();
    try {
      const encryptedBackup =
        activeVault.createEncryptedProjectBackup("application");
      const payload = CryptoUtil.decryptJson(encryptedBackup, backup);
      assert.deepEqual(
        payload.projectRecord.environments[
          payload.projectRecord.defaultEnvironmentId
        ].configurationBaseline,
        originalBaseline
      );
    } finally {
      backup.fill(0);
    }
    await activeVault.clearProjectConfigurationBaseline(
      defaultTarget(activeVault, "application")
    );
    assert.equal(
      activeVault.getProjectConfigurationBaseline(
        defaultTarget(activeVault, "application")
      ).configurationBaseline,
      null
    );
    assert.deepEqual(
      activeVault.getSecret(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalSecret
    );
    assert.deepEqual(
      activeVault.getSecretHistory(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalHistory
    );

    await activeVault.replaceProjectConfigurationBaseline(
      defaultTarget(activeVault, "application"),
      ["DATABASE_URL"]
    );
  });

  await first.session.close({ reason: "manual" });
  const second = createRuntime(directory);
  await second.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  await second.session.withActiveSession(({ activeVault }) => {
    assert.deepEqual(
      activeVault.getProjectConfigurationBaseline(
        defaultTarget(activeVault, "application")
      ).configurationBaseline.requiredKeys,
      ["DATABASE_URL"]
    );
    assert.deepEqual(
      activeVault.getSecret(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalSecret
    );
    assert.deepEqual(
      activeVault.getSecretHistory(
        defaultTarget(activeVault, "application"),
        "DATABASE_URL"
      ),
      originalHistory
    );
  });
  await second.session.close({ reason: "manual" });
});

test("Projects without a baseline reopen without rewriting stored Vault data", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-no-configuration-baseline-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const first = createRuntime(directory);
  await first.session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await first.session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("application")
  );
  const { vaultPath } = first.vaultManager.systemVault;
  await first.session.close({ reason: "manual" });
  const beforeOpen = fs.readFileSync(vaultPath);

  const second = createRuntime(directory);
  await second.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  await second.session.withActiveSession(({ activeVault }) => {
    const snapshot = activeVault.getProjectConfigurationBaseline(
      defaultTarget(activeVault, "application")
    );
    assert.equal(snapshot.configurationBaseline, null);
  });
  assert.deepEqual(fs.readFileSync(vaultPath), beforeOpen);
  await second.session.close({ reason: "manual" });
});

test("idle recovery restores a configured Project baseline through VaultSession", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-recovered-configuration-baseline-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const first = createRuntime(directory);
  await first.session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await first.session.withActiveSession(async ({ activeVault }) => {
    activeVault.createProject("application");
    await activeVault.replaceProjectConfigurationBaseline(
      defaultTarget(activeVault, "application"),
      ["API_KEY", "DATABASE_URL"]
    );
    await activeVault.saveNow();
  });
  const { vaultPath } = first.vaultManager.systemVault;
  fs.unlinkSync(vaultPath);

  const closed = await first.session.close({ reason: "idle" });
  assert.equal(closed.outcome, "closed");
  assert.equal(first.session.snapshot().state, "locked");
  const recoveryHeaders = await first.vaultManager.recoveryStore.enumerate();
  const header = recoveryHeaders.find((entry) => entry.kind === "vault");
  assert.ok(header);

  const second = createRuntime(directory);
  const reopened = await second.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  assert.equal(reopened.state, "recovering");
  const recovery = second.session
    .snapshot()
    .recovery.find((entry) => entry.capsuleId === header.capsuleId);
  assert.ok(recovery);
  await second.session.resolveRecovery({
    artifactId: "system",
    capsuleId: header.capsuleId,
    decision: "keep_recovered",
    kind: "vault",
  });
  await second.session.withActiveSession(({ activeVault }) => {
    assert.deepEqual(
      activeVault.getProjectConfigurationBaseline(
        defaultTarget(activeVault, "application")
      ).configurationBaseline.requiredKeys,
      ["API_KEY", "DATABASE_URL"]
    );
  });
  await second.session.close({ reason: "manual" });
});

test("invalid persisted Project configuration metadata fails closed", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-invalid-configuration-baseline-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const first = createRuntime(directory);
  await first.session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await first.session.withActiveSession(async ({ activeVault }) => {
    activeVault.createProject("application");
    await activeVault.replaceProjectConfigurationBaseline(
      defaultTarget(activeVault, "application"),
      ["API_KEY"]
    );
  });
  const key = first.vaultManager.copySystemKey();
  const { vaultPath } = first.vaultManager.systemVault;
  await first.session.close({ reason: "manual" });

  try {
    const data = CryptoUtil.decryptJson(fs.readFileSync(vaultPath), key);
    const { defaultEnvironmentId } = data.projects.application;
    data.projects.application.environments[
      defaultEnvironmentId
    ].configurationBaseline.requiredKeys = ["not-a-shell-key"];
    fs.writeFileSync(vaultPath, CryptoUtil.encryptJson(data, key), {
      mode: 0o600,
    });
  } finally {
    key.fill(0);
  }

  const second = createRuntime(directory);
  await assert.rejects(
    second.session.open({
      credential: PASSWORD,
      method: "password",
      reason: "manual",
    }),
    (failure) => failure.code === "VAULT_SESSION_OPEN_FAILED"
  );
});
