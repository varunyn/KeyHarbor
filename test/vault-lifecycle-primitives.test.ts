const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const CryptoUtil = require("../src/modules/crypto");
const Vault = require("../src/modules/vault");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");

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

const PASSWORD = "lifecycle-primitives-password";

const temporaryDirectory = (t, prefix) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
};

const stopAutoSave = (vault) => {
  if (vault.saveTimeout) {
    clearTimeout(vault.saveTimeout);
  }
  vault.saveTimeout = null;
};

test("Vault tracks dirty and persisted revisions and separates prepare from seal", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-lifecycle-vault-");
  const vault = new Vault(directory, { vaultId: "system" });
  await vault.setup(PASSWORD);

  assert.match(vault.getVaultInstanceId(), /^[a-f0-9]{64}$/u);
  assert.equal(vault.isDirty(), false);
  vault.createProject("project");
  stopAutoSave(vault);
  assert.equal(vault.isDirty(), true);

  const result = await vault.prepareForClose();
  assert.equal(result.status, "persisted");
  assert.equal(vault.isDirty(), false);
  assert.equal(vault.isLocked, false);

  vault.seal();
  assert.equal(vault.isLocked, true);
  assert.equal(vault.key, null);
  assert.equal(vault.data, null);
});

test("legacy Vault identity is durably migrated during authenticated open", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-legacy-identity-");
  const original = new Vault(directory);
  await original.setup(PASSWORD);
  const key = Buffer.from(original.key);
  const bytes = fs.readFileSync(original.vaultPath);
  const data = CryptoUtil.decryptJson(bytes, key);
  delete data.vaultInstanceId;
  fs.writeFileSync(original.vaultPath, CryptoUtil.encryptJson(data, key), {
    mode: 0o600,
  });
  original.seal();

  const migrated = new Vault(directory);
  await migrated.unlock(PASSWORD);
  const instanceId = migrated.getVaultInstanceId();
  assert.match(instanceId, /^[a-f0-9]{64}$/u);
  migrated.seal();

  const reopened = new Vault(directory);
  await reopened.unlock(PASSWORD);
  assert.equal(reopened.getVaultInstanceId(), instanceId);
});

test("VaultManager returns structured close results and seals only on commit", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-manager-close-");
  const manager = new VaultManager(directory);
  manager.init();
  await manager.setupSystemVault(PASSWORD);
  manager.systemVault.createProject("project");
  stopAutoSave(manager.systemVault);

  const prepared = await manager.prepareClose({ reason: "manual" });
  assert.equal(prepared.config.status, "clean");
  assert.equal(prepared.vaults[0].status, "persisted");
  assert.equal(manager.systemVault.isLocked, false);

  await manager.sealSession();
  assert.equal(manager.systemVault, null);
  assert.equal(manager.vaults.size, 0);
});

test("VaultManager session context exposes a narrow Vault facade", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-manager-facade-");
  const manager = new VaultManager(directory);
  manager.init();
  await manager.setupSystemVault(PASSWORD);
  manager.systemVault.createProject("facade");
  manager.systemVault.setSecret(
    defaultTarget(manager.systemVault, "facade"),
    "token",
    "value"
  );

  const context = manager.createSessionContext(new AbortController().signal);
  assert.equal(context.activeVault.key, undefined);
  assert.equal(context.activeVault.data, undefined);
  assert.equal(context.activeVault.seal, undefined);
  assert.equal(
    context.activeVault.getSecret(
      defaultTarget(context.activeVault, "facade"),
      "token"
    ).value,
    "value"
  );
  assert.ok(
    Buffer.isBuffer(context.activeVault.createEncryptedProjectBackup("facade"))
  );
});

test("corrupt manager configuration fails closed and is not overwritten", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-manager-config-");
  const manager = new VaultManager(directory);
  manager.init();
  await manager.setupSystemVault(PASSWORD);
  manager.sealAllVaults();
  const corrupt = Buffer.from("not-an-encrypted-config");
  fs.writeFileSync(path.join(directory, "vaults.enc"), corrupt);

  const reopened = new VaultManager(directory);
  reopened.init();
  await assert.rejects(
    reopened.unlockAll(PASSWORD),
    (failure) => failure.code === "VAULT_SESSION_CONFIG_INVALID"
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "vaults.enc")),
    corrupt
  );
});

test("VaultManager can authenticate a missing system Vault into recovery", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-manager-recovery-");
  const store = new VaultRecoveryStore(path.join(directory, "recovery"));
  const manager = new VaultManager(directory, { recoveryStore: store });
  manager.init();
  await manager.setupSystemVault(PASSWORD);
  manager.systemVault.createProject("session-only");
  stopAutoSave(manager.systemVault);
  const record = manager.getRecoveryRecord("system");
  const header = store.writeCapsule(record);
  record.key.fill(0);
  manager.sealAllVaults();
  fs.unlinkSync(path.join(directory, "vault-v2.enc"));

  const reopened = new VaultManager(directory, { recoveryStore: store });
  reopened.init();
  const result = await reopened.openSession({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
    recoveryHeaders: [header],
  });
  assert.equal(result.state, "recovering");
  assert.equal(result.recovery[0].artifactId, "system");
  assert.equal(reopened.systemVault.getProjects()[0].name, "session-only");
});

test("legacy manager recovery binds and preserves its captured source pair", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-legacy-manager-recovery-");
  const store = new VaultRecoveryStore(path.join(directory, "recovery"));
  const manager = new VaultManager(directory, { recoveryStore: store });
  manager.init();
  await manager.setupSystemVault(PASSWORD);
  const originalKey = Buffer.from(manager.systemVault.key);
  const vaultInstanceId = manager.systemVault.getVaultInstanceId();
  const legacySalt = fs.readFileSync(path.join(directory, "salt-v2.txt"));
  const legacyCiphertext = Buffer.from("legacy encrypted source");
  const recoveryRecord = manager.getRecoveryRecord("system");
  /* Preserve the legacy encrypted fixture field order used by migration and backup contracts. */
  /* eslint-disable sort-keys */
  const payload = {
    ...recoveryRecord.payload,
    sessionData: {
      version: 1,
      vaultInstanceId,
      projects: {
        application: {
          secrets: {
            TOKEN: {
              value: "recovered",
              history: [
                { value: "older", updatedAt: "2024-01-01T00:00:00.000Z" },
              ],
            },
          },
          configurationBaseline: {
            requiredKeys: ["TOKEN"],
            revision: "legacy-revision",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      },
      favorites: {
        projects: ["application"],
        secrets: { application: ["TOKEN"] },
      },
    },
    baseline: {
      projects: {
        application: {
          secrets: { TOKEN: { value: "before recovery" } },
          configurationBaseline: {
            requiredKeys: ["TOKEN"],
            revision: "legacy-baseline",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      },
      favorites: { projects: [], secrets: { application: [] } },
    },
  };
  /* eslint-enable sort-keys */
  const header = store.writeCapsule({ ...recoveryRecord, payload });
  recoveryRecord.key.fill(0);
  manager.sealAllVaults();
  fs.unlinkSync(path.join(directory, "vault-v2.enc"));
  fs.unlinkSync(path.join(directory, "salt-v2.txt"));
  fs.writeFileSync(path.join(directory, "vault.enc"), legacyCiphertext);
  fs.writeFileSync(path.join(directory, "salt.txt"), legacySalt);

  const reopened = new VaultManager(directory, { recoveryStore: store });
  reopened.init();
  const result = await reopened.openSession({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
    recoveryHeaders: [header],
  });
  assert.equal(result.state, "recovering");
  const recoverySalt = fs.readFileSync(path.join(directory, "salt.txt"));
  fs.writeFileSync(
    path.join(directory, "salt.txt"),
    Buffer.from("changed while recovery was pending")
  );
  await assert.rejects(
    reopened.resolveRecovery({
      artifactId: "system",
      capsuleId: header.capsuleId,
      decision: "keep_recovered",
      kind: "vault",
    }),
    { code: "VAULT_LEGACY_DIVERGENCE" }
  );
  fs.writeFileSync(path.join(directory, "salt.txt"), recoverySalt);
  await reopened.resolveRecovery({
    artifactId: "system",
    capsuleId: header.capsuleId,
    decision: "keep_recovered",
    kind: "vault",
  });
  assert.equal(
    reopened.systemVault.getSecret(
      defaultTarget(reopened.systemVault, "application"),
      "TOKEN"
    ).value,
    "recovered"
  );
  assert.equal(
    reopened.systemVault.getSecretHistory(
      defaultTarget(reopened.systemVault, "application"),
      "TOKEN"
    ).history.length,
    1
  );
  const recoveredEnvironmentId =
    reopened.systemVault.getEnvironments("application")[0].id;
  assert.deepEqual(
    reopened.systemVault.getFavorites().secrets.application[
      recoveredEnvironmentId
    ],
    ["TOKEN"]
  );
  const recoveredSnapshot = reopened.systemVault.createRecoverySnapshot();
  assert.deepEqual(
    Object.keys(recoveredSnapshot.baseline.projects.application.environments),
    [recoveredEnvironmentId]
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "vault-v1-pre-environments.enc")),
    legacyCiphertext
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "salt-v1-pre-environments.txt")),
    legacySalt
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "salt-v2.txt")),
    recoverySalt
  );
  fs.writeFileSync(
    path.join(directory, "salt.txt"),
    Buffer.from("changed old salt")
  );
  assert.throws(
    () =>
      reopened.systemVault.getSecret(
        defaultTarget(reopened.systemVault, "application"),
        "TOKEN"
      ),
    { code: "VAULT_LEGACY_DIVERGENCE" }
  );
  const persisted = CryptoUtil.decryptJson(
    fs.readFileSync(path.join(directory, "vault-v2.enc")),
    originalKey
  );
  assert.equal(
    persisted.projects.application.environments[recoveredEnvironmentId].secrets
      .TOKEN.value,
    "recovered"
  );
  originalKey.fill(0);
});

test("VaultManager blocks password rotation while system recovery is pending", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-manager-rotation-");
  const store = new VaultRecoveryStore(path.join(directory, "recovery"));
  const manager = new VaultManager(directory, { recoveryStore: store });
  manager.init();
  await manager.setupSystemVault(PASSWORD);
  manager.systemVault.createProject("pending");
  stopAutoSave(manager.systemVault);
  const record = manager.getRecoveryRecord("system");
  store.writeCapsule(record);
  record.key.fill(0);

  await assert.rejects(
    manager.changeSystemPassword(PASSWORD, "replacement-password"),
    (failure) => failure.code === "VAULT_RECOVERY_PENDING"
  );
  assert.equal(manager.systemVault.verifyPassword(PASSWORD), true);
});
