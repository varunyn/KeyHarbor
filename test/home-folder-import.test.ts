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

test("multiple selected folders retain separate guarded reviews across navigation", async (t) => {
  const { coordinator, root, session, target } = await fixture(t);
  const found = await coordinator.discoverFolder(root);
  assert.ok(found.success);
  const b = found.discovery.folders.find((folder) => folder.path === "B");
  const c = found.discovery.folders.find((folder) => folder.path === "C");
  assert.ok(b && c);
  const first = await target(b.suggestedName);
  const second = await target(c.suggestedName);
  const staged = await coordinator.stageFolderChoices([
    { choiceId: b.id, target: first },
    { choiceId: c.id, target: second },
  ]);
  assert.ok(staged.success);
  coordinator.clear({ preserveFolderHandoff: true });
  const firstScan = await coordinator.resumeFolder(first);
  assert.ok(firstScan.success);
  assert.equal(firstScan.scan.remainingProjects, 1);
  assert.deepEqual(
    firstScan.scan.files.map((file) => file.path),
    ["B/.env", "B/.env.test"]
  );
  const preview = await coordinator.previewFolderFile(
    first,
    firstScan.scan.scanId,
    firstScan.scan.files[0].id
  );
  assert.ok(preview.success && preview.handle);
  const committed = await coordinator.commit(
    preview.handle,
    preview.entries.map((entry) => ({
      action: "add",
      key: entry.key,
      occurrenceId: entry.occurrences[0].id,
    }))
  );
  assert.ok(committed.success);
  const untouched = await session.withActiveSession(({ activeVault }) =>
    activeVault.getImportProjectSnapshot(second, ["TOKEN"])
  );
  assert.equal(untouched.secrets.TOKEN, null);
  // Reviewing the first Project may take longer than a navigation handoff's two-minute lifetime.
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 120_001);
  const advanced = await coordinator.nextFolder(firstScan.scan.scanId);
  assert.ok(advanced.success);
  assert.deepEqual(advanced.target, {
    environmentId: second.environmentId,
    projectName: second.projectName,
  });
  coordinator.clear({ preserveFolderHandoff: true });
  const secondScan = await coordinator.resumeFolder(second);
  assert.ok(secondScan.success);
  assert.equal(secondScan.scan.remainingProjects, 0);
  assert.deepEqual(
    secondScan.scan.files.map((file) => file.path),
    ["C/.env"]
  );
  const finished = await coordinator.nextFolder(secondScan.scan.scanId);
  assert.equal(finished.success, false);
});

test("batch staging rejects invalid or repeated selections without leaving a partial handoff", async (t) => {
  const { coordinator, root, target } = await fixture(t);
  const first = await target("first");
  const second = await target("second");
  const found = await coordinator.discoverFolder(root);
  assert.ok(found.success);
  const b = found.discovery.folders.find((folder) => folder.path === "B");
  const c = found.discovery.folders.find((folder) => folder.path === "C");
  assert.ok(b && c);
  for (const selections of [
    [],
    [
      { choiceId: b.id, target: first },
      { choiceId: "forged", target: second },
    ],
    [
      { choiceId: b.id, target: first },
      { choiceId: b.id, target: second },
    ],
    [
      { choiceId: b.id, target: first },
      { choiceId: c.id, target: first },
    ],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await coordinator.stageFolderChoices(selections);
    assert.equal(result.success, false);
    // eslint-disable-next-line no-await-in-loop
    const partial = await coordinator.resumeFolder(first);
    assert.equal(partial.success, false);
  }
});

test("closing a folder review discards the rest of the batch", async (t) => {
  const { coordinator, root, target } = await fixture(t);
  const first = await target("first");
  const second = await target("second");
  const found = await coordinator.discoverFolder(root);
  assert.ok(found.success);
  const staged = await coordinator.stageFolderChoices([
    { choiceId: found.discovery.folders[0].id, target: first },
    { choiceId: found.discovery.folders[1].id, target: second },
  ]);
  assert.ok(staged.success);
  coordinator.clear({ preserveFolderHandoff: true });
  const current = await coordinator.resumeFolder(first);
  assert.ok(current.success);
  await coordinator.discard(current.scan.scanId);
  const advanced = await coordinator.nextFolder(current.scan.scanId);
  assert.equal(advanced.success, false);
  assert.equal(coordinator._folders.queue.length, 0);
});

test("the next Project is rejected if its captured identity was replaced", async (t) => {
  const { coordinator, root, session, target } = await fixture(t);
  const first = await target("first");
  const second = await target("second");
  const found = await coordinator.discoverFolder(root);
  assert.ok(found.success);
  const staged = await coordinator.stageFolderChoices([
    { choiceId: found.discovery.folders[0].id, target: first },
    { choiceId: found.discovery.folders[1].id, target: second },
  ]);
  assert.ok(staged.success);
  coordinator.clear({ preserveFolderHandoff: true });
  const current = await coordinator.resumeFolder(first);
  assert.ok(current.success);
  await session.withActiveSession(({ activeVault }) => {
    activeVault.deleteProject("second");
    activeVault.createProject("second");
  });
  const advanced = await coordinator.nextFolder(current.scan.scanId);
  assert.equal(advanced.success, false);
  assert.equal(coordinator._folders.queue.length, 0);
});
