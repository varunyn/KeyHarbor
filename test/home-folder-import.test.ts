import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import EnvTextImportCoordinator = require("../src/modules/env-text-import-coordinator");

const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");

const fixture = async (t: {
  after: (callback: () => Promise<void>) => void;
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keyharbor-home-"));
  const root = path.join(directory, "A");
  fs.mkdirSync(path.join(root, "B", "nested"), { recursive: true });
  fs.mkdirSync(path.join(root, "C"));
  fs.writeFileSync(path.join(root, ".env.example"), "TOKEN=\nMISSING=\n");
  fs.writeFileSync(path.join(root, ".env.local"), "ROOT=private-root");
  fs.writeFileSync(path.join(root, "B", ".env"), "TOKEN=private-b");
  fs.writeFileSync(path.join(root, "B", ".env.test"), "TOKEN=private-test");
  fs.writeFileSync(
    path.join(root, "B", "nested", ".env"),
    "NESTED=private-nested"
  );
  fs.writeFileSync(path.join(root, "C", ".env"), "TOKEN=private-c");
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
  t.after(async () => {
    await session.close({ reason: "manual" });
    fs.rmSync(directory, { force: true, recursive: true });
  });
  await session.open({
    credential: "home-import-test",
    method: "setup",
    reason: "setup",
  });
  const coordinator = new EnvTextImportCoordinator({ session });
  const target = (name: string) =>
    session.withActiveSession(({ activeVault }) => {
      activeVault.createProject(name);
      return activeVault.resolveEnvironmentTarget({ projectName: name });
    });
  return { coordinator, root, session, target };
};

test("Home discovery groups exact folders, preserves names and templates, and never returns values", async (t) => {
  const { coordinator, root, target } = await fixture(t);
  const found = await coordinator.discoverFolder(root);
  assert.ok(found.success);
  assert.equal(JSON.stringify(found).includes("private-"), false);
  assert.deepEqual(
    found.discovery.folders.map(({ fileCount, suggestedName }) => ({
      fileCount,
      suggestedName,
    })),
    [
      { fileCount: 1, suggestedName: "A" },
      { fileCount: 2, suggestedName: "A → B" },
      { fileCount: 1, suggestedName: "A → B → nested" },
      { fileCount: 1, suggestedName: "A → C" },
    ]
  );
  const b = found.discovery.folders.find((folder) => folder.path === "B");
  assert.ok(b);
  const destination = await target(b.suggestedName);
  const stagedB = await coordinator.stageFolderChoice(destination, b.id);
  assert.ok(stagedB.success);
  coordinator.clear({ preserveFolderHandoff: true });
  const resumed = await coordinator.resumeFolder(destination);
  assert.ok(resumed.success);
  assert.equal(resumed.scan.folderName, "A → B");
  assert.deepEqual(
    resumed.scan.files.map((file) => file.path),
    ["B/.env", "B/.env.test"]
  );
  assert.equal(resumed.scan.files[0].templatePath, ".env.example");
  assert.deepEqual(resumed.scan.files[0].missingKeys, ["MISSING"]);
  const preview = await coordinator.previewFolderFile(
    destination,
    resumed.scan.scanId,
    resumed.scan.files[0].id
  );
  assert.ok(preview.success);
  assert.equal(preview.entries[0].key, "TOKEN");
  assert.equal(JSON.stringify(preview).includes("private-b"), false);
  const consumed = await coordinator.resumeFolder(destination);
  assert.equal(consumed.success, false);

  // Dropping A again can target C without including B's files.
  const droppedAgain = await coordinator.discoverFolder(root);
  assert.ok(droppedAgain.success);
  const c = droppedAgain.discovery.folders.find(
    (folder) => folder.path === "C"
  );
  assert.ok(c);
  const cTarget = await target(c.suggestedName);
  const stagedC = await coordinator.stageFolderChoice(cTarget, c.id);
  assert.ok(stagedC.success);
  coordinator.clear({ preserveFolderHandoff: true });
  const cScan = await coordinator.resumeFolder(cTarget);
  assert.ok(cScan.success);
  assert.deepEqual(
    cScan.scan.files.map((file) => file.path),
    ["C/.env"]
  );
});

test("Home choices reject forged handles, rescans, cleared sessions and changed destinations", async (t) => {
  const { coordinator, root, target } = await fixture(t);
  const first = await target("first");
  const second = await target("second");
  const forged = await coordinator.stageFolderChoice(first, "../C");
  assert.equal(forged.success, false);
  const found = await coordinator.discoverFolder(root);
  assert.ok(found.success);
  const oldChoice = found.discovery.folders[0].id;
  const rescanned = await coordinator.discoverFolder(root);
  assert.ok(rescanned.success);
  const stale = await coordinator.stageFolderChoice(first, oldChoice);
  assert.equal(stale.success, false);
  const staged = await coordinator.stageFolderChoice(
    first,
    rescanned.discovery.folders[0].id
  );
  assert.ok(staged.success);
  const changed = await coordinator.resumeFolder(second);
  assert.equal(changed.success, false);
  const current = await coordinator.discoverFolder(root);
  assert.ok(current.success);
  coordinator.clear();
  const cleared = await coordinator.stageFolderChoice(
    first,
    current.discovery.folders[0].id
  );
  assert.equal(cleared.success, false);
});
