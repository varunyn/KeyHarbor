import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { registerEnvironmentManagementIpc } from "../src/modules/environment-management-ipc";
import VaultManager = require("../src/modules/vault-manager");
import VaultRecoveryStore from "../src/modules/vault-recovery-store";
import VaultSession from "../src/modules/vault-session";

const password = "environment-management-test-password";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "keyharbor-env-management-")
);
const recoveryStore = new VaultRecoveryStore(path.join(directory, "recovery"));
const vaultManager = new VaultManager(directory, { recoveryStore });
const session = new VaultSession({
  httpIngress: { disableSensitive() {}, enableSensitive() {} },
  logger: { clearEncryptionKey() {}, setEncryptionKey() {} },
  recoveryStore,
  settingsProvider: () => ({ autoLockEnabled: false, diskSyncIntervalMs: 0 }),
  vaultManager,
});
const handlers = new Map<
  string,
  (_event: unknown, ...args: unknown[]) => unknown
>();

before(async () => {
  vaultManager.init();
  await session.open({
    credential: password,
    method: "setup",
    reason: "setup",
  });
  registerEnvironmentManagementIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    session,
  });
});

after(async () => {
  await session.close({ reason: "manual" });
  fs.rmSync(directory, { force: true, recursive: true });
});

const invoke = <T>(name: string, ...args: unknown[]): Promise<T> => {
  const handler = handlers.get(name);
  assert.ok(handler, `production IPC handler ${name} is registered`);
  return handler({}, ...args) as Promise<T>;
};

test("Environment management IPC preserves identity, returns metadata only, and enforces default deletion rules", async () => {
  await session.withActiveSession(({ activeVault }) => {
    activeVault.createProject("service");
    activeVault.setSecret(
      activeVault.resolveEnvironmentTarget({ projectName: "service" }),
      "TOKEN",
      "private-value"
    );
  });

  const initial = await invoke<{
    data: {
      id: string;
      name: string;
      secretCount: number;
      isDefault: boolean;
    }[];
    success: boolean;
  }>("projects:environments", "service");
  assert.equal(initial.success, true);
  assert.equal(initial.data.length, 1);
  const originalId = initial.data[0].id;
  assert.equal(initial.data[0].name, "default");
  assert.equal(initial.data[0].secretCount, 1);
  assert.equal(JSON.stringify(initial).includes("private-value"), false);

  const created = await invoke<{
    environment: { id: string; name: string; secretCount: number };
    success: boolean;
  }>("project:environment:create", "service", "dev");
  assert.equal(created.success, true);
  assert.equal(created.environment.secretCount, 0);
  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  const devTarget = {
    projectName: "service",
    environmentId: created.environment.id,
  };

  const renamed = await invoke<{
    environment: { id: string; name: string };
    success: boolean;
  }>("project:environment:rename", devTarget, "development");
  assert.equal(renamed.success, true);
  assert.equal(renamed.environment.id, devTarget.environmentId);
  assert.equal(renamed.environment.name, "development");

  const omittedReplacement = await invoke<{ success: boolean }>(
    "project:environment:delete",
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    { projectName: "service", environmentId: originalId }
  );
  assert.equal(omittedReplacement.success, false);
  const defaultDelete = await invoke<{
    success: boolean;
    defaultEnvironmentId: string;
    affectedSecretCount: number;
  }>(
    "project:environment:delete",
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    { projectName: "service", environmentId: originalId },
    devTarget.environmentId
  );
  assert.equal(defaultDelete.success, true);
  assert.equal(defaultDelete.defaultEnvironmentId, devTarget.environmentId);
  assert.equal(defaultDelete.affectedSecretCount, 1);
  const lastDelete = await invoke<{ success: boolean }>(
    "project:environment:delete",
    devTarget
  );
  assert.equal(lastDelete.success, false);
  const current = await invoke<{
    data: { id: string; isDefault: boolean }[];
    success: boolean;
  }>("projects:environments", "service");
  assert.equal(current.data.length, 1);
  assert.equal(current.data[0].id, devTarget.environmentId);
  assert.equal(current.data[0].isDefault, true);
});
