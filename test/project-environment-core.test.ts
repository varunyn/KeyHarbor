const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const CryptoUtil = require("../src/modules/crypto");
const Vault = require("../src/modules/vault");
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
