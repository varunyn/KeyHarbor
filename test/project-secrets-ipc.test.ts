import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { registerProjectSecretsIpc } from "../src/modules/project-secrets-ipc";
import VaultManager = require("../src/modules/vault-manager");
import VaultRecoveryStore = require("../src/modules/vault-recovery-store");
import VaultSession = require("../src/modules/vault-session");

const password = "project-secrets-ipc-test-password";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "keyharbor-project-secrets-")
);
const recoveryStore = new VaultRecoveryStore(path.join(directory, "recovery"));
const vaultManager = new VaultManager(directory, { recoveryStore });
const session = new VaultSession({
  httpIngress: { disableSensitive() {}, enableSensitive() {} },
  logger: {
    clearEncryptionKey() {},
    countCompletedAccess: () => 3,
    logAccess: () => {},
    logApp: () => {},
    setEncryptionKey() {},
  },
  recoveryStore,
  settingsProvider: () => ({ autoLockEnabled: false, diskSyncIntervalMs: 0 }),
  vaultManager,
});

const handlers = new Map<
  string,
  (_event: unknown, ...args: unknown[]) => unknown
>();

let approvalDecision = { approved: true };

before(async () => {
  vaultManager.init();
  await session.open({
    credential: password,
    method: "setup",
    reason: "setup",
  });
  registerProjectSecretsIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    logger: {
      countCompletedAccess: () => 5,
      logAccess: () => {},
    },
    session,
    showApprovalDialog: () => Promise.resolve(approvalDecision),
    vaultManager,
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

test("Project and Secret IPC handlers manage projects, secrets, and favorites correctly", async () => {
  // 1. Create project
  const createResult = await invoke<{ success: boolean }>(
    "project:create",
    "alpha"
  );
  assert.equal(createResult.success, true);

  // 2. Get projects
  const getProjectsResult = await invoke<{
    data: { name: string }[];
    success: boolean;
  }>("projects:get");
  assert.equal(getProjectsResult.success, true);
  assert.ok(getProjectsResult.data.some((p) => p.name === "alpha"));

  // 3. Target validation for secret operations
  const invalidTargetResult = await invoke<{
    error: string;
    success: boolean;
  }>("secrets:get", null);
  assert.equal(invalidTargetResult.success, false);
  assert.equal(
    invalidTargetResult.error,
    "A Project and Environment are required"
  );

  // Resolve valid target
  const target = await session.withActiveSession(({ activeVault }) =>
    activeVault.resolveEnvironmentTarget({ projectName: "alpha" })
  );

  // 4. Set secret
  const setResult = await invoke<{ success: boolean }>(
    "secret:set",
    target,
    "API_KEY",
    "secret-val-123"
  );
  assert.equal(setResult.success, true);

  // 5. Get secrets list
  const getSecretsResult = await invoke<{
    data: Record<string, { value: string }>;
    success: boolean;
  }>("secrets:get", target);
  assert.equal(getSecretsResult.success, true);
  assert.equal(getSecretsResult.data.API_KEY.value, "secret-val-123");

  // 6. Read secret with approval
  approvalDecision = { approved: true };
  const readSecretResult = await invoke<{
    data: { value: string };
    success: boolean;
  }>("secret:get", target, "API_KEY");
  assert.equal(readSecretResult.success, true);
  assert.equal(readSecretResult.data.value, "secret-val-123");

  // 7. Read secret when denied
  approvalDecision = { approved: false };
  const deniedResult = await invoke<{
    error: string;
    success: boolean;
  }>("secret:get", target, "API_KEY");
  assert.equal(deniedResult.success, false);
  assert.equal(deniedResult.error, "Access denied");

  // 8. Update secret (rename + value)
  const updateResult = await invoke<{ success: boolean }>(
    "secret:update",
    target,
    "API_KEY",
    "NEW_KEY",
    "updated-val"
  );
  assert.equal(updateResult.success, true);

  // 9. Verify renamed secret
  const postUpdate = await invoke<{
    data: Record<string, { value: string }>;
    success: boolean;
  }>("secrets:get", target);
  assert.equal(postUpdate.data.NEW_KEY.value, "updated-val");
  assert.equal(postUpdate.data.API_KEY, undefined);

  // 10. Favorites toggle
  const favProject = await invoke<{ added: boolean; success: boolean }>(
    "favorite:toggleProject",
    "alpha"
  );
  assert.equal(favProject.success, true);
  assert.equal(favProject.added, true);

  const favSecret = await invoke<{ added: boolean; success: boolean }>(
    "favorite:toggleSecret",
    target,
    "NEW_KEY"
  );
  assert.equal(favSecret.success, true);
  assert.equal(favSecret.added, true);

  const getFavorites = await invoke<{
    data: { projects: string[]; secrets: unknown[] };
    success: boolean;
  }>("favorites:get");
  assert.equal(getFavorites.success, true);
  assert.ok(getFavorites.data.projects.includes("alpha"));

  // 11. Statistics
  const stats = await invoke<{
    data: { recentAccessCount: number };
    success: boolean;
  }>("statistics:get");
  assert.equal(stats.success, true);
  assert.equal(stats.data.recentAccessCount, 5);

  // 12. Delete secret
  const deleteSecretResult = await invoke<{ success: boolean }>(
    "secret:delete",
    target,
    "NEW_KEY"
  );
  assert.equal(deleteSecretResult.success, true);

  // 13. Delete project
  const deleteProjectResult = await invoke<{ success: boolean }>(
    "project:delete",
    "alpha"
  );
  assert.equal(deleteProjectResult.success, true);
});
