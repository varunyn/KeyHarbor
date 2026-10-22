import assert = require("node:assert/strict");
import crypto = require("node:crypto");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import test = require("node:test");
import type { TestContext } from "node:test";
import ConfigurationBaseline = require("../src/modules/project-configuration-baseline");
import Vault = require("../src/modules/vault");
import VaultManager = require("../src/modules/vault-manager");

const CryptoUtil = require("../src/modules/crypto");

const PASSWORD = "environment-core-test-password";

const temporaryDirectory = (t: TestContext, prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
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
  assert.ok(vault);
  const [defaultEnvironment] = vault.getEnvironments("application");
  assert.equal(defaultEnvironment.name, "default");
  assert.equal(defaultEnvironment.isDefault, true);
  assert.deepEqual(
    vault.getSecret(
      vault.resolveEnvironmentTarget({ projectName: "application" }),
      "API_TOKEN"
    ).tags,
    ["production"]
  );
  assert.equal(
    vault.getSecretHistory(
      vault.resolveEnvironmentTarget({ projectName: "application" }),
      "API_TOKEN"
    ).history[0].value,
    "older-secret"
  );
  const baseline = vault.getProjectConfigurationBaseline(
    vault.resolveEnvironmentTarget({ projectName: "application" })
  );
  assert.ok(baseline.configurationBaseline);
  assert.deepEqual(baseline.configurationBaseline.requiredKeys, ["API_TOKEN"]);
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
