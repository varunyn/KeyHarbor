const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const CryptoUtil = require("../src/modules/crypto");
const Vault = require("../src/modules/vault");
const VaultManager = require("../src/modules/vault-manager");
const ConfigurationBaseline = require("../src/modules/project-configuration-baseline");

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

const PASSWORD = "environment-core-test-password";

const sortValues = <T>(values: T[]): T[] => {
  const copied = [...values];
  // Sorting a local copy works with the supported ES2022 library target.
  // eslint-disable-next-line unicorn/no-array-sort
  return copied.sort();
};

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

test("legacy Project data migrates into one default Environment while immutable encrypted inputs remain intact", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-environment-migration-");
  const salt = crypto.randomBytes(32);
  const key = CryptoUtil.deriveKey(PASSWORD, salt);
  const now = new Date().toISOString();
  /* Preserve the legacy encrypted fixture field order used by migration and backup contracts. */
  /* eslint-disable sort-keys */
  const legacyData = {
    version: "1.0.0",
    createdAt: now,
    updatedAt: now,
    favorites: {
      projects: ["application"],
      secrets: { application: ["API_TOKEN"] },
    },
    projects: {
      application: {
        createdAt: now,
        updatedAt: now,
        secrets: {
          API_TOKEN: {
            value: "legacy-secret",
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
            description: "preserved",
            tags: ["production"],
            history: [
              {
                value: "older-secret",
                expiresAt: null,
                description: "",
                tags: [],
                changedAt: now,
              },
            ],
          },
        },
        configurationBaseline: ConfigurationBaseline.createBaseline(
          ["API_TOKEN"],
          new Date(now)
        ),
      },
    },
  };
  /* eslint-enable sort-keys */
  const oldVaultBytes = CryptoUtil.encryptJson(legacyData, key);
  const oldSaltBytes = Buffer.from(salt.toString("hex"));
  const oldConfigBytes = CryptoUtil.encryptJson(
    /* Preserve the legacy encrypted fixture field order used by migration and backup contracts. */
    /* eslint-disable sort-keys */
    { version: 1, systemVaultInstanceId: null, otherVaults: [] },
    /* eslint-enable sort-keys */ key
  );
  fs.writeFileSync(path.join(directory, "vault.enc"), oldVaultBytes, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(directory, "salt.txt"), oldSaltBytes, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(directory, "vaults.enc"), oldConfigBytes, {
    mode: 0o600,
  });
  key.fill(0);

  const manager = new VaultManager(directory);
  manager.init();
  await manager.unlockAll(PASSWORD);
  const vault = manager.systemVault;
  const [defaultEnvironment] = vault.getEnvironments("application");
  assert.equal(defaultEnvironment.name, "default");
  assert.equal(defaultEnvironment.isDefault, true);
  assert.deepEqual(
    vault.getSecret(defaultTarget(vault, "application"), "API_TOKEN").tags,
    ["production"]
  );
  assert.equal(
    vault.getSecretHistory(defaultTarget(vault, "application"), "API_TOKEN")
      .history[0].value,
    "older-secret"
  );
  assert.deepEqual(
    vault.getProjectConfigurationBaseline(defaultTarget(vault, "application"))
      .configurationBaseline.requiredKeys,
    ["API_TOKEN"]
  );
  assert.deepEqual(
    vault.getFavorites().secrets.application[defaultEnvironment.id],
    ["API_TOKEN"]
  );

  assert.deepEqual(
    fs.readFileSync(path.join(directory, "vault.enc")),
    oldVaultBytes
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "salt.txt")),
    oldSaltBytes
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "vaults.enc")),
    oldConfigBytes
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "vault-v1-pre-environments.enc")),
    oldVaultBytes
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "salt-v1-pre-environments.txt")),
    oldSaltBytes
  );
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "vaults-v1-pre-environments.enc")),
    oldConfigBytes
  );

  const migratedBytes = fs.readFileSync(path.join(directory, "vault-v2.enc"));
  const migratedData = CryptoUtil.decryptJson(migratedBytes, vault.key);
  assert.equal(migratedData.vaultFormatVersion, 2);
  assert.deepEqual(
    migratedData.projects.application.environments[defaultEnvironment.id]
      .secrets.API_TOKEN,
    legacyData.projects.application.secrets.API_TOKEN
  );
  assert.equal(fs.existsSync(path.join(directory, "vaults-v2.enc")), true);
  await manager.sealSession();
});

test("unsupported fields in legacy Vault schemas reject migration without publishing v2 files", async (t) => {
  for (const location of ["root", "project"] as const) {
    const directory = temporaryDirectory(
      t,
      `keyharbor-unknown-legacy-${location}-`
    );
    const salt = crypto.randomBytes(32);
    const key = CryptoUtil.deriveKey(PASSWORD, salt);
    /* Preserve the legacy encrypted fixture field order used by migration and backup contracts. */
    /* eslint-disable sort-keys */
    const legacyData: Record<string, unknown> = {
      version: "1.0.0",
      projects: {
        application: {
          name: "application",
          secrets: { TOKEN: "must be preserved or rejected" },
        },
      },
      favorites: { projects: [], secrets: {} },
    };
    /* eslint-enable sort-keys */
    if (location === "root") {
      legacyData.futureFormat = "unknown root field";
    } else {
      (
        legacyData.projects as Record<string, Record<string, unknown>>
      ).application.futureFormat = "unknown project field";
    }
    const oldVaultBytes = CryptoUtil.encryptJson(legacyData, key);
    const oldSaltBytes = Buffer.from(salt.toString("hex"));
    fs.writeFileSync(path.join(directory, "vault.enc"), oldVaultBytes, {
      mode: 0o600,
    });
    fs.writeFileSync(path.join(directory, "salt.txt"), oldSaltBytes, {
      mode: 0o600,
    });
    const vault = new Vault(directory);

    // Run lifecycle cases sequentially so each transition and its assertions finish before the next case.
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(vault.unlock(PASSWORD), /legacy|invalid vault/iu);
    assert.deepEqual(
      fs.readFileSync(path.join(directory, "vault.enc")),
      oldVaultBytes
    );
    assert.deepEqual(
      fs.readFileSync(path.join(directory, "salt.txt")),
      oldSaltBytes
    );
    assert.equal(fs.existsSync(path.join(directory, "vault-v2.enc")), false);
    assert.equal(fs.existsSync(path.join(directory, "salt-v2.txt")), false);
    vault.seal();
    key.fill(0);
  }
});

test("separate Environment additions from two real Vault sessions merge by stable Environment ID", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-environment-merge-");
  const first = new Vault(directory);
  await first.setup(PASSWORD);
  first.createProject("application");
  const [shared] = first.getEnvironments("application");
  await first.saveNow();

  const second = new Vault(directory);
  await second.unlock(PASSWORD);
  const dev = first.createEnvironment("application", "dev");
  first.setSecret(
    { environmentId: dev.id, projectName: "application" },
    "DATABASE_URL",
    "dev-db"
  );
  stopAutoSave(first);
  const qa = second.createEnvironment("application", "qa");
  second.setSecret(
    { environmentId: qa.id, projectName: "application" },
    "DATABASE_URL",
    "qa-db"
  );
  stopAutoSave(second);

  await first.saveNow();
  assert.deepEqual(await second.reconcileExternalChange(), {
    changed: true,
    status: "merged",
  });
  assert.deepEqual(
    new Set(
      second.getEnvironments("application").map((environment) => environment.id)
    ),
    new Set([shared.id, dev.id, qa.id])
  );
  assert.equal(
    second.getSecret(
      { environmentId: dev.id, projectName: "application" },
      "DATABASE_URL"
    ).value,
    "dev-db"
  );
  assert.equal(
    second.getSecret(
      { environmentId: qa.id, projectName: "application" },
      "DATABASE_URL"
    ).value,
    "qa-db"
  );
  await first.seal();
  await second.seal();
});

test("simultaneous Environment names and same-Environment divergent edits require explicit resolution", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-environment-conflict-");
  const first = new Vault(directory);
  await first.setup(PASSWORD);
  first.createProject("application");
  const shared = first.createEnvironment("application", "shared");
  first.setSecret(
    { environmentId: shared.id, projectName: "application" },
    "TOKEN",
    "initial"
  );
  stopAutoSave(first);
  await first.saveNow();

  const second = new Vault(directory);
  await second.unlock(PASSWORD);
  first.setSecret(
    { environmentId: shared.id, projectName: "application" },
    "TOKEN",
    "left"
  );
  stopAutoSave(first);
  second.setSecret(
    { environmentId: shared.id, projectName: "application" },
    "TOKEN",
    "right"
  );
  stopAutoSave(second);
  const collision = first.createEnvironment("application", "stage");
  const separateCollision = second.createEnvironment("application", "stage");
  assert.notEqual(collision.id, separateCollision.id);
  first.setDefaultEnvironment("application", collision.id);
  second.setDefaultEnvironment("application", separateCollision.id);
  stopAutoSave(first);
  stopAutoSave(second);
  await first.saveNow();
  const outcome = await second.reconcileExternalChange();
  assert.equal(outcome.status, "needs_resolution");
  assert.ok(
    outcome.conflicts.some((conflict) => conflict.reason === "divergent_edit")
  );
  const nameConflict = outcome.conflicts.find(
    (conflict) => conflict.reason === "environment_name_collision"
  );
  assert.ok(nameConflict);
  assert.equal(nameConflict.sessionEnvironmentName, "stage");
  assert.equal(nameConflict.diskEnvironmentName, "stage");
  assert.ok(nameConflict.sessionEnvironmentId);
  assert.ok(nameConflict.diskEnvironmentId);
  const defaultConflict = outcome.conflicts.find(
    (conflict) => conflict.reason === "default_environment_divergent"
  );
  assert.ok(defaultConflict);
  assert.equal(defaultConflict.sessionEnvironmentName, "stage");
  assert.equal(defaultConflict.diskEnvironmentName, "stage");
  assert.equal(defaultConflict.sessionPreview, "stage");
  assert.equal(defaultConflict.diskPreview, "stage");
  await first.seal();
  await second.seal();
});

test("favorite edits in separate Environments merge, while an edit racing Environment deletion conflicts", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-environment-favorites-");
  const first = new Vault(directory);
  await first.setup(PASSWORD);
  first.createProject("application");
  const dev = first.createEnvironment("application", "dev");
  const qa = first.createEnvironment("application", "qa");
  first.setSecret(
    { environmentId: dev.id, projectName: "application" },
    "TOKEN",
    "dev"
  );
  first.setSecret(
    { environmentId: qa.id, projectName: "application" },
    "TOKEN",
    "qa"
  );
  stopAutoSave(first);
  await first.saveNow();
  const second = new Vault(directory);
  await second.unlock(PASSWORD);

  first.toggleSecretFavorite(
    { environmentId: dev.id, projectName: "application" },
    "TOKEN"
  );
  second.toggleSecretFavorite(
    { environmentId: qa.id, projectName: "application" },
    "TOKEN"
  );
  stopAutoSave(first);
  stopAutoSave(second);
  await first.saveNow();
  assert.deepEqual(await second.reconcileExternalChange(), {
    changed: true,
    status: "merged",
  });
  assert.deepEqual(second.getFavorites().secrets.application[dev.id], [
    "TOKEN",
  ]);
  assert.deepEqual(second.getFavorites().secrets.application[qa.id], ["TOKEN"]);

  first.deleteEnvironment("application", dev.id);
  stopAutoSave(first);
  second.toggleSecretFavorite(
    { environmentId: dev.id, projectName: "application" },
    "TOKEN"
  );
  stopAutoSave(second);
  await first.saveNow();
  const outcome = await second.reconcileExternalChange();
  assert.equal(outcome.status, "needs_resolution");
  assert.ok(
    outcome.conflicts.some(
      (conflict) => conflict.reason === "environment_deleted_favorite_changed"
    )
  );
  await first.seal();
  await second.seal();
});

test("Environment lifecycle keeps targets stable until rename, then invalidates deleted and recreated targets", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-environment-lifecycle-");
  const vault = new Vault(directory);
  await vault.setup(PASSWORD);
  vault.createProject("a");
  vault.createProject("a:b");
  const [defaultEnvironment] = vault.getEnvironments("a");
  const [otherProjectEnvironment] = vault.getEnvironments("a:b");
  assert.throws(() => vault.createEnvironment("a", ""), /Environment name/u);
  const dev = vault.createEnvironment("a", "dev");
  assert.equal(dev.secretCount, 0);
  assert.throws(() => vault.createEnvironment("a", "dev"), /already exists/u);
  assert.throws(
    () => vault.renameEnvironment("a", dev.id, "default"),
    /already exists/u
  );

  const beforeRename = vault.getEnvironmentTargetIdentity({
    environmentId: dev.id,
    projectName: "a",
  });
  vault.setSecret(
    { environmentId: dev.id, projectName: "a" },
    "TOKEN",
    "dev-token"
  );
  vault.setSecret(defaultTarget(vault, "a"), "DEFAULT_TOKEN", "default-token");
  vault.toggleSecretFavorite(
    { environmentId: dev.id, projectName: "a" },
    "TOKEN"
  );
  vault.setDefaultEnvironment("a", dev.id);
  const selectedTarget = vault.resolveEnvironmentTarget({ projectName: "a" });
  assert.equal(selectedTarget.environmentId, dev.id);
  assert.equal(vault.getSecret(selectedTarget, "TOKEN").value, "dev-token");
  assert.throws(
    () =>
      vault.getSecret(
        "a" as unknown as { projectName: string; environmentId: string },
        "TOKEN"
      ),
    /Environment target requires projectName/u
  );
  assert.throws(
    () =>
      vault.resolveEnvironmentTarget({ environmentId: "", projectName: "a" }),
    /non-empty string/u
  );
  assert.throws(
    () =>
      vault.resolveEnvironmentTarget({
        environmentId: null as unknown as string,
        projectName: "a",
      }),
    /non-empty string/u
  );
  assert.throws(
    () =>
      vault.resolveEnvironmentTarget({
        environmentId: dev.id,
        environmentName: "default",
        projectName: "a",
      }),
    (failure) => failure.code === "ENVIRONMENT_TARGET_MISMATCH"
  );
  assert.equal(
    vault.getStatistics({ environmentId: dev.id, projectName: "a" })
      .totalSecrets,
    1
  );
  assert.throws(
    () => vault.getStatistics(false as unknown as null),
    /Environment target requires projectName/u
  );
  const renamed = vault.renameEnvironment("a", dev.id, "development");
  assert.equal(renamed.environmentName, "development");
  assert.notEqual(
    renamed.environmentIncarnation,
    beforeRename.environmentIncarnation
  );
  await assert.rejects(
    vault.replaceProjectConfigurationBaseline(
      { environmentId: dev.id, projectName: "a" },
      ["TOKEN"],
      {
        environmentIncarnation: beforeRename.environmentIncarnation,
      }
    ),
    (failure) => failure.code === "CONFIGURATION_BASELINE_STALE"
  );

  assert.throws(
    () => vault.deleteEnvironment("a", dev.id),
    /replacement default/u
  );
  const deleted = vault.deleteEnvironment("a", dev.id, {
    replacementDefaultEnvironmentId: defaultEnvironment.id,
  });
  assert.equal(deleted.defaultEnvironmentId, defaultEnvironment.id);
  assert.throws(
    () => vault.getSecret({ environmentId: dev.id, projectName: "a" }, "TOKEN"),
    (failure) => failure.code === "ENVIRONMENT_NOT_FOUND"
  );
  assert.throws(
    () => vault.deleteEnvironment("a", defaultEnvironment.id),
    /at least one Environment/u
  );
  const recreated = vault.createEnvironment("a", "development");
  assert.notEqual(recreated.id, dev.id);
  assert.throws(
    () => vault.getSecret({ environmentId: dev.id, projectName: "a" }, "TOKEN"),
    (failure) => failure.code === "ENVIRONMENT_NOT_FOUND"
  );
  const otherProjectBeforeDelete = vault.getEnvironmentTargetIdentity({
    environmentId: otherProjectEnvironment.id,
    projectName: "a:b",
  });
  vault.deleteProject("a");
  const otherProjectAfterDelete = vault.getEnvironmentTargetIdentity({
    environmentId: otherProjectEnvironment.id,
    projectName: "a:b",
  });
  assert.equal(
    otherProjectAfterDelete.environmentIncarnation,
    otherProjectBeforeDelete.environmentIncarnation
  );
  await vault.seal();
});

test("unchanged Environment deletion and default replacement merge without losing valid defaults", async (t) => {
  const directory = temporaryDirectory(
    t,
    "keyharbor-environment-delete-merge-"
  );
  const first = new Vault(directory);
  await first.setup(PASSWORD);
  first.createProject("application");
  const [originalDefault] = first.getEnvironments("application");
  const dev = first.createEnvironment("application", "dev");
  const stage = first.createEnvironment("application", "stage");
  stopAutoSave(first);
  await first.saveNow();

  const second = new Vault(directory);
  await second.unlock(PASSWORD);
  first.deleteEnvironment("application", dev.id);
  stopAutoSave(first);
  await first.saveNow();
  assert.deepEqual(await second.reconcileExternalChange(), {
    changed: true,
    status: "merged",
  });
  assert.deepEqual(
    sortValues(
      second.getEnvironments("application").map((environment) => environment.id)
    ),
    sortValues([originalDefault.id, stage.id])
  );
  assert.equal(
    second
      .getEnvironments("application")
      .find((environment) => environment.isDefault)?.id,
    originalDefault.id
  );

  first.deleteEnvironment("application", originalDefault.id, {
    replacementDefaultEnvironmentId: stage.id,
  });
  stopAutoSave(first);
  await first.saveNow();
  assert.deepEqual(await second.reconcileExternalChange(), {
    changed: true,
    status: "merged",
  });
  assert.deepEqual(
    second.getEnvironments("application").map((environment) => environment.id),
    [stage.id]
  );
  assert.equal(second.getEnvironments("application")[0].isDefault, true);
  await first.seal();
  await second.seal();
});

test("v2 backups preserve every Environment record and legacy backup restore validates atomically", async (t) => {
  const directory = temporaryDirectory(t, "keyharbor-environment-backup-");
  const vault = new Vault(directory);
  await vault.setup(PASSWORD);
  vault.createProject("original");
  const production = vault.createEnvironment("original", "production");
  vault.setSecret(
    { environmentId: production.id, projectName: "original" },
    "TOKEN",
    "first",
    null,
    {
      description: "rotating",
      tags: ["app"],
    }
  );
  vault.setSecret(
    { environmentId: production.id, projectName: "original" },
    "TOKEN",
    "second"
  );
  await vault.replaceProjectConfigurationBaseline(
    { environmentId: production.id, projectName: "original" },
    ["TOKEN"]
  );
  vault.toggleSecretFavorite(
    { environmentId: production.id, projectName: "original" },
    "TOKEN"
  );
  stopAutoSave(vault);
  const originalHistory = vault.getSecretHistory(
    { environmentId: production.id, projectName: "original" },
    "TOKEN"
  );
  const encryptedBackup = vault.createEncryptedProjectBackup("original");
  vault.restoreEncryptedProjectBackup(encryptedBackup, "restored");
  assert.deepEqual(
    vault
      .getEnvironments("restored")
      .map(({ id, name, secretCount, isDefault }) => ({
        id,
        isDefault,
        name,
        secretCount,
      })),
    [
      {
        id: vault
          .getEnvironments("original")
          .find((environment) => environment.name === "default").id,
        isDefault: true,
        name: "default",
        secretCount: 0,
      },
      {
        id: production.id,
        isDefault: false,
        name: "production",
        secretCount: 1,
      },
    ]
  );
  assert.deepEqual(
    vault.getSecret(
      { environmentId: production.id, projectName: "restored" },
      "TOKEN"
    ),
    vault.getSecret(
      { environmentId: production.id, projectName: "original" },
      "TOKEN"
    )
  );
  assert.deepEqual(
    vault.getSecretHistory(
      { environmentId: production.id, projectName: "restored" },
      "TOKEN"
    ),
    originalHistory
  );
  const restoredBaseline = vault.getProjectConfigurationBaseline({
    environmentId: production.id,
    projectName: "restored",
  }).configurationBaseline;
  assert.ok(restoredBaseline);
  assert.deepEqual(restoredBaseline.requiredKeys, ["TOKEN"]);
  assert.deepEqual(
    restoredBaseline,
    vault.getProjectConfigurationBaseline({
      environmentId: production.id,
      projectName: "original",
    }).configurationBaseline
  );
  assert.deepEqual(vault.getFavorites().secrets.restored[production.id], [
    "TOKEN",
  ]);

  const beforeProjects = sortValues(
    vault.getProjects().map((project) => project.name)
  );
  const badBackup = CryptoUtil.encryptJson(
    /* Preserve the legacy encrypted fixture field order used by migration and backup contracts. */
    /* eslint-disable sort-keys */
    {
      format: "localkeys-backup",
      version: 1,
      project: "bad",
      secrets: { TOKEN: 42 },
    },
    /* eslint-enable sort-keys */ vault.key
  );
  assert.throws(
    () => vault.restoreEncryptedProjectBackup(badBackup),
    /Invalid Vault secret record/u
  );
  assert.deepEqual(
    sortValues(vault.getProjects().map((project) => project.name)),
    beforeProjects
  );
  assert.throws(
    () => vault.getSecret(defaultTarget(vault, "bad"), "TOKEN"),
    /does not exist/u
  );

  const now = new Date().toISOString();
  const legacyBackup = CryptoUtil.encryptJson(
    /* Preserve the legacy encrypted fixture field order used by migration and backup contracts. */
    /* eslint-disable sort-keys */
    {
      format: "localkeys-backup",
      version: 1,
      project: "legacy",
      secrets: {
        TOKEN: {
          value: "legacy-value",
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
          description: "legacy metadata",
          tags: ["legacy"],
          history: [
            {
              value: "prior",
              expiresAt: null,
              description: "",
              tags: [],
              changedAt: now,
            },
          ],
        },
      },
      configurationBaseline: ConfigurationBaseline.createBaseline(
        ["TOKEN"],
        new Date(now)
      ),
    },
    /* eslint-enable sort-keys */ vault.key
  );
  vault.restoreEncryptedProjectBackup(legacyBackup);
  const [legacyDefault] = vault.getEnvironments("legacy");
  assert.equal(
    vault.getSecret(defaultTarget(vault, "legacy"), "TOKEN").description,
    "legacy metadata"
  );
  assert.equal(
    vault.getSecretHistory(defaultTarget(vault, "legacy"), "TOKEN").history[0]
      .value,
    "prior"
  );
  assert.deepEqual(
    vault.getProjectConfigurationBaseline(defaultTarget(vault, "legacy"))
      .configurationBaseline.requiredKeys,
    ["TOKEN"]
  );
  assert.equal(legacyDefault.name, "default");
  await vault.seal();
});
