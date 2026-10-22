import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import test = require("node:test");
import type { TestContext } from "node:test";
import Vault = require("../src/modules/vault");

type VaultInstance = InstanceType<typeof Vault>;
type UntrustedEnvironmentSelector =
  | string
  | boolean
  | null
  | {
      environmentId?: string | null;
      environmentName?: string;
      projectName: string;
    };

const PASSWORD = "environment-core-test-password";

const temporaryDirectory = (t: TestContext, prefix: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
};

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
  const beforeRenameIncarnation = beforeRename.environmentIncarnation;
  assert.ok(beforeRenameIncarnation);
  vault.setSecret(
    { environmentId: dev.id, projectName: "a" },
    "TOKEN",
    "dev-token"
  );
  vault.setSecret(
    vault.resolveEnvironmentTarget({ projectName: "a" }),
    "DEFAULT_TOKEN",
    "default-token"
  );
  vault.toggleSecretFavorite(
    { environmentId: dev.id, projectName: "a" },
    "TOKEN"
  );
  vault.setDefaultEnvironment("a", dev.id);
  const selectedTarget = vault.resolveEnvironmentTarget({ projectName: "a" });
  assert.equal(selectedTarget.environmentId, dev.id);
  assert.equal(vault.getSecret(selectedTarget, "TOKEN").value, "dev-token");
  // SAFETY: The public method validates runtime selectors before accessing target fields.
  const getSecretWithUntrustedTarget = vault.getSecret as (
    this: VaultInstance,
    selector: UntrustedEnvironmentSelector,
    key: string
  ) => ReturnType<VaultInstance["getSecret"]>;
  assert.throws(
    () => getSecretWithUntrustedTarget.call(vault, "a", "TOKEN"),
    /Environment target requires projectName/u
  );
  assert.throws(
    () =>
      vault.resolveEnvironmentTarget({ environmentId: "", projectName: "a" }),
    /non-empty string/u
  );
  // SAFETY: The public method validates runtime selectors before resolving an Environment.
  const resolveEnvironmentTargetWithUntrustedSelector =
    vault.resolveEnvironmentTarget as (
      this: VaultInstance,
      selector: UntrustedEnvironmentSelector
    ) => ReturnType<VaultInstance["resolveEnvironmentTarget"]>;
  assert.throws(
    () =>
      resolveEnvironmentTargetWithUntrustedSelector.call(vault, {
        environmentId: null,
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
    { code: "ENVIRONMENT_TARGET_MISMATCH" }
  );
  assert.equal(
    vault.getStatistics({ environmentId: dev.id, projectName: "a" })
      .totalSecrets,
    1
  );
  // SAFETY: The public method validates runtime selectors before reading statistics.
  const getStatisticsWithUntrustedSelector = vault.getStatistics as (
    this: VaultInstance,
    selector: UntrustedEnvironmentSelector
  ) => ReturnType<VaultInstance["getStatistics"]>;
  assert.throws(
    () => getStatisticsWithUntrustedSelector.call(vault, false),
    /Environment target requires projectName/u
  );
  const renamed = vault.renameEnvironment("a", dev.id, "development");
  assert.equal(renamed.environmentName, "development");
  assert.notEqual(renamed.environmentIncarnation, beforeRenameIncarnation);
  await assert.rejects(
    vault.replaceProjectConfigurationBaseline(
      { environmentId: dev.id, projectName: "a" },
      ["TOKEN"],
      {
        environmentIncarnation: beforeRenameIncarnation,
      }
    ),
    { code: "CONFIGURATION_BASELINE_STALE" }
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
    { code: "ENVIRONMENT_NOT_FOUND" }
  );
  assert.throws(
    () => vault.deleteEnvironment("a", defaultEnvironment.id),
    /at least one Environment/u
  );
  const recreated = vault.createEnvironment("a", "development");
  assert.notEqual(recreated.id, dev.id);
  assert.throws(
    () => vault.getSecret({ environmentId: dev.id, projectName: "a" }, "TOKEN"),
    { code: "ENVIRONMENT_NOT_FOUND" }
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
