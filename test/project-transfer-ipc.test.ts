import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { registerProjectTransferIpc } from "../src/modules/project-transfer-ipc";
import VaultManager = require("../src/modules/vault-manager");
import VaultRecoveryStore from "../src/modules/vault-recovery-store";
import VaultSession from "../src/modules/vault-session";

const password = "project-transfer-ipc-test-password";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "keyharbor-project-transfer-")
);
const recoveryStore = new VaultRecoveryStore(path.join(directory, "recovery"));
const vaultManager = new VaultManager(directory, { recoveryStore });
const session = new VaultSession({
  httpIngress: { disableSensitive() {}, enableSensitive() {} },
  logger: {
    clearEncryptionKey() {},
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

let saveDialogResult: { canceled: boolean; filePath?: string } = {
  canceled: false,
  filePath: "",
};

before(async () => {
  vaultManager.init();
  await session.open({
    credential: password,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) => {
    activeVault.createProject("service-app");
    const target = activeVault.resolveEnvironmentTarget({
      projectName: "service-app",
    });
    activeVault.setSecret(target, "DB_HOST", "localhost");
    activeVault.setSecret(target, "DB_PASS", "secret-p@ss");
  });
  registerProjectTransferIpc({
    dialog: {
      showSaveDialog: () => Promise.resolve(saveDialogResult),
    },
    getWindow: () => ({}),
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    logger: {
      logAccess: () => {},
      logApp: () => {},
    },
    session,
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

test("Project transfer IPC handles export and backup with validation and save dialogs", async () => {
  const target = await session.withActiveSession(({ activeVault }) =>
    activeVault.resolveEnvironmentTarget({ projectName: "service-app" })
  );

  // 1. Target validation
  const invalidTarget = await invoke<{ error: string; success: boolean }>(
    "secrets:export",
    null
  );
  assert.equal(invalidTarget.success, false);
  assert.equal(invalidTarget.error, "A Project and Environment are required");

  // 2. Unsupported export mode
  const unsupportedMode = await invoke<{
    code: string;
    error: string;
    success: boolean;
  }>("secrets:export", target, "invalid-mode");
  assert.equal(unsupportedMode.success, false);
  assert.equal(unsupportedMode.code, "EXPORT_MODE_UNSUPPORTED");

  // 3. Canceled export dialog
  saveDialogResult = { canceled: true };
  const canceledExport = await invoke<{
    cancelled: boolean;
    success: boolean;
  }>("secrets:export", target, "example");
  assert.equal(canceledExport.success, false);
  assert.equal(canceledExport.cancelled, true);

  // 4. Successful export in example mode
  const exampleExportPath = path.join(directory, "service-app.env.example");
  saveDialogResult = { canceled: false, filePath: exampleExportPath };
  const exampleResult = await invoke<{ path: string; success: boolean }>(
    "secrets:export",
    target,
    "example"
  );
  assert.equal(exampleResult.success, true);
  assert.equal(exampleResult.path, exampleExportPath);
  const exampleContent = fs.readFileSync(exampleExportPath, "utf-8");
  assert.ok(exampleContent.includes("DB_HOST="));
  assert.ok(exampleContent.includes("DB_PASS="));

  // 5. Successful export in raw mode (with password)
  const rawExportPath = path.join(directory, "service-app.env");
  saveDialogResult = { canceled: false, filePath: rawExportPath };
  const rawResult = await invoke<{ path: string; success: boolean }>(
    "secrets:export",
    target,
    "raw",
    { password }
  );
  assert.equal(rawResult.success, true);
  const rawContent = fs.readFileSync(rawExportPath, "utf-8");
  assert.ok(rawContent.includes('DB_HOST="localhost"'));
  assert.ok(rawContent.includes('DB_PASS="secret-p@ss"'));

  // 6. Backup: project required
  const invalidBackup = await invoke<{ error: string; success: boolean }>(
    "projects:backup",
    ""
  );
  assert.equal(invalidBackup.success, false);
  assert.equal(invalidBackup.error, "A Project is required");

  // 7. Successful backup export
  const backupExportPath = path.join(directory, "service-app.lkvb");
  saveDialogResult = { canceled: false, filePath: backupExportPath };
  const backupResult = await invoke<{ path: string; success: boolean }>(
    "projects:backup",
    "service-app"
  );
  assert.equal(backupResult.success, true);
  assert.equal(backupResult.path, backupExportPath);
  assert.ok(fs.existsSync(backupExportPath));
  assert.ok(fs.statSync(backupExportPath).size > 0);
});
