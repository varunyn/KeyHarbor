const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const CryptoUtil = require("../src/modules/crypto");
const Vault = require("../src/modules/vault");

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

const PASSWORD = "reconciliation-test-password";

const stopAutoSave = (vault) => {
  if (vault.saveTimeout) {
    clearTimeout(vault.saveTimeout);
    vault.saveTimeout = null;
  }
};

const createHarness = async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-reconcile-")
  );
  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const vault = new Vault(directory);
  await vault.setup(PASSWORD);
  stopAutoSave(vault);
  return { directory, vault };
};

const openPeer = async (directory) => {
  const peer = new Vault(directory);
  await peer.unlock(PASSWORD);
  stopAutoSave(peer);
  return peer;
};

const seedProject = async (vault, projectName = "shared") => {
  vault.createProject(projectName);
  vault.setSecret(defaultTarget(vault, projectName), "base", "one");
  stopAutoSave(vault);
  await vault.saveNow();
};

const setRequiredKeys = async (vault, requiredKeys, projectName = "shared") => {
  const target = defaultTarget(vault, projectName);
  const snapshot = vault.getProjectConfigurationBaseline(target);
  // oxlint-disable-next-line eslint/sort-keys -- Preserve baseline option insertion order used by the existing fixture.
  const expected = {
    incarnation: snapshot.incarnation,
    baseline: {
      exists: snapshot.configurationBaseline !== null,
      revision: snapshot.configurationBaseline?.revision,
    },
  };
  await (requiredKeys === null
    ? vault.clearProjectConfigurationBaseline(target, expected)
    : vault.replaceProjectConfigurationBaseline(
        target,
        requiredKeys,
        expected
      ));
};

const readSecretFromDisk = async (directory, projectName, key) => {
  const reader = await openPeer(directory);
  return reader.getSecret(defaultTarget(reader, projectName), key).value;
};

test("unchanged disk returns unchanged without rewriting", async (t) => {
  const { vault } = await createHarness(t);
  const before = fs.statSync(vault.vaultPath).mtimeMs;
  assert.deepEqual(await vault.reconcileExternalChange({ origin: "focus" }), {
    status: "unchanged",
  });
  assert.equal(fs.statSync(vault.vaultPath).mtimeMs, before);
});

test("a disk-only edit is adopted without losing data", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  peer.setSecret(defaultTarget(peer, "shared"), "remote", "disk-value");
  stopAutoSave(peer);
  await peer.saveNow();

  assert.deepEqual(
    await vault.reconcileExternalChange({ origin: "periodic" }),
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    { status: "merged", changed: true }
  );
  assert.equal(
    vault.getSecret(defaultTarget(vault, "shared"), "remote").value,
    "disk-value"
  );
});

test("independent session and disk edits merge and persist", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  vault.setSecret(defaultTarget(vault, "shared"), "local", "session-value");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "remote", "disk-value");
  stopAutoSave(peer);
  await peer.saveNow();

  assert.deepEqual(
    await vault.reconcileExternalChange({ origin: "periodic" }),
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    { status: "merged", changed: true }
  );
  assert.equal(
    vault.getSecret(defaultTarget(vault, "shared"), "local").value,
    "session-value"
  );
  assert.equal(
    vault.getSecret(defaultTarget(vault, "shared"), "remote").value,
    "disk-value"
  );
  assert.equal(
    await readSecretFromDisk(directory, "shared", "local"),
    "session-value"
  );
});

test("divergent edits require an explicit decision and hide raw values", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  vault.setSecret(
    defaultTarget(vault, "shared"),
    "base",
    "session-secret-value"
  );
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "base", "disk-secret-value");
  stopAutoSave(peer);
  await peer.saveNow();

  const outcome = await vault.reconcileExternalChange({
    origin: "external-notification",
  });
  assert.equal(outcome.status, "needs_resolution");
  assert.equal(outcome.reason, "conflict");
  assert.deepEqual(outcome.allowedDecisions, ["use_disk", "keep_session"]);
  assert.equal(JSON.stringify(outcome).includes("session-secret-value"), false);
  assert.equal(JSON.stringify(outcome).includes("disk-secret-value"), false);
});

test("divergent simultaneous additions conflict", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  vault.setSecret(defaultTarget(vault, "shared"), "new-key", "session");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "new-key", "disk");
  stopAutoSave(peer);
  await peer.saveNow();

  const outcome = await vault.reconcileExternalChange({ origin: "focus" });
  assert.equal(outcome.conflicts[0].reason, "simultaneous_add_divergent");
});

test("delete versus edit conflicts while delete versus unchanged removes the Secret", async (t) => {
  const first = await createHarness(t);
  await seedProject(first.vault);
  const firstPeer = await openPeer(first.directory);
  first.vault.deleteSecret(defaultTarget(first.vault, "shared"), "base");
  stopAutoSave(first.vault);
  firstPeer.setSecret(defaultTarget(firstPeer, "shared"), "base", "edited");
  stopAutoSave(firstPeer);
  await firstPeer.saveNow();
  const conflict = await first.vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(conflict.conflicts[0].reason, "local_deleted_remote_edited");

  const second = await createHarness(t);
  await seedProject(second.vault);
  const secondPeer = await openPeer(second.directory);
  second.vault.deleteSecret(defaultTarget(second.vault, "shared"), "base");
  stopAutoSave(second.vault);
  secondPeer.createProject("unrelated");
  stopAutoSave(secondPeer);
  await secondPeer.saveNow();
  const awaitedResult1 = await second.vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(awaitedResult1.status, "merged");
  assert.equal(
    Object.hasOwn(
      second.vault.getSecrets(defaultTarget(second.vault, "shared")),
      "base"
    ),
    false
  );
});

test("Project delete versus edit conflicts", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  vault.deleteProject("shared");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "remote", "changed");
  stopAutoSave(peer);
  await peer.saveNow();

  const outcome = await vault.reconcileExternalChange({ origin: "focus" });
  assert.equal(
    outcome.conflicts[0].reason,
    "local_deleted_project_remote_changed"
  );
});

test("one-sided requirement changes merge with independent Secret edits", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  await setRequiredKeys(vault, ["API_KEY"]);
  stopAutoSave(vault);
  await vault.saveNow();
  const peer = await openPeer(directory);

  await setRequiredKeys(vault, ["API_KEY", "DATABASE_URL"]);
  vault.setSecret(defaultTarget(vault, "shared"), "local", "session-value");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "remote", "disk-value");
  stopAutoSave(peer);
  await peer.saveNow();

  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  assert.deepEqual(await vault.reconcileExternalChange({ origin: "focus" }), {
    status: "merged",
    changed: true,
  });
  assert.deepEqual(
    vault.getProjectConfigurationBaseline(defaultTarget(vault, "shared"))
      .configurationBaseline.requiredKeys,
    ["API_KEY", "DATABASE_URL"]
  );
  assert.equal(
    vault.getSecret(defaultTarget(vault, "shared"), "local").value,
    "session-value"
  );
  assert.equal(
    vault.getSecret(defaultTarget(vault, "shared"), "remote").value,
    "disk-value"
  );
});

test("equal requirement sets with different revisions merge without a conflict", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  await setRequiredKeys(vault, ["API_KEY"]);
  await setRequiredKeys(peer, ["API_KEY"]);
  const diskRevision = peer.getProjectConfigurationBaseline(
    defaultTarget(peer, "shared")
  ).configurationBaseline.revision;
  const sessionRevision = vault.getProjectConfigurationBaseline(
    defaultTarget(vault, "shared")
  ).configurationBaseline.revision;
  stopAutoSave(vault);
  stopAutoSave(peer);
  await peer.saveNow();

  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  assert.deepEqual(await vault.reconcileExternalChange({ origin: "focus" }), {
    status: "merged",
    changed: true,
  });
  const saved = vault.getProjectConfigurationBaseline(
    defaultTarget(vault, "shared")
  ).configurationBaseline;
  assert.deepEqual(saved.requiredKeys, ["API_KEY"]);
  assert.notEqual(saved.revision, sessionRevision);
  assert.equal(saved.revision, diskRevision);
});

test("divergent and clear-versus-edit requirement changes require explicit resolution", async (t) => {
  const divergent = await createHarness(t);
  await seedProject(divergent.vault);
  await setRequiredKeys(divergent.vault, ["API_KEY"]);
  stopAutoSave(divergent.vault);
  await divergent.vault.saveNow();
  const peer = await openPeer(divergent.directory);
  await setRequiredKeys(divergent.vault, ["API_KEY", "LOCAL_KEY"]);
  await setRequiredKeys(peer, ["API_KEY", "REMOTE_KEY"]);
  stopAutoSave(divergent.vault);
  stopAutoSave(peer);
  await peer.saveNow();

  const conflict = await divergent.vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(conflict.status, "needs_resolution");
  assert.equal(conflict.conflicts[0].kind, "configurationBaseline");
  assert.equal(
    conflict.conflicts[0].reason,
    "configuration_baseline_divergent"
  );
  assert.deepEqual(conflict.conflicts[0].sessionRequiredKeys, [
    "API_KEY",
    "LOCAL_KEY",
  ]);
  assert.deepEqual(conflict.conflicts[0].diskRequiredKeys, [
    "API_KEY",
    "REMOTE_KEY",
  ]);

  const clearEdit = await createHarness(t);
  await seedProject(clearEdit.vault);
  await setRequiredKeys(clearEdit.vault, ["API_KEY"]);
  stopAutoSave(clearEdit.vault);
  await clearEdit.vault.saveNow();
  const clearPeer = await openPeer(clearEdit.directory);
  await setRequiredKeys(clearEdit.vault, null);
  await setRequiredKeys(clearPeer, ["API_KEY", "DATABASE_URL"]);
  stopAutoSave(clearEdit.vault);
  stopAutoSave(clearPeer);
  await clearPeer.saveNow();

  const clearConflict = await clearEdit.vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(clearConflict.status, "needs_resolution");
  assert.equal(clearConflict.conflicts[0].kind, "configurationBaseline");
  assert.equal(clearConflict.conflicts[0].sessionRequiredKeys, null);
  assert.deepEqual(clearConflict.conflicts[0].diskRequiredKeys, [
    "API_KEY",
    "DATABASE_URL",
  ]);
});

test("Project deletion versus a requirements change conflicts", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  await setRequiredKeys(vault, ["API_KEY"]);
  stopAutoSave(vault);
  await vault.saveNow();
  const peer = await openPeer(directory);
  vault.deleteProject("shared");
  await setRequiredKeys(peer, ["API_KEY", "DATABASE_URL"]);
  stopAutoSave(peer);
  await peer.saveNow();

  const conflict = await vault.reconcileExternalChange({ origin: "focus" });
  assert.equal(conflict.status, "needs_resolution");
  assert.equal(conflict.conflicts[0].kind, "project");
  assert.equal(
    conflict.conflicts[0].reason,
    "local_deleted_project_remote_changed"
  );
});

test("deleting a configured Project merges when the disk copy is unchanged", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  await setRequiredKeys(vault, ["API_KEY"]);
  stopAutoSave(vault);
  await vault.saveNow();
  const peer = await openPeer(directory);
  vault.deleteProject("shared");
  stopAutoSave(vault);
  peer.createProject("unrelated");
  stopAutoSave(peer);
  await peer.saveNow();

  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  assert.deepEqual(await vault.reconcileExternalChange({ origin: "focus" }), {
    status: "merged",
    changed: true,
  });
  assert.deepEqual(
    vault.getProjects().map((project) => project.name),
    ["unrelated"]
  );
});

test("one-sided favorites merge while incompatible favorites conflict", async (t) => {
  const first = await createHarness(t);
  await seedProject(first.vault);
  const firstPeer = await openPeer(first.directory);
  first.vault.toggleProjectFavorite("shared");
  stopAutoSave(first.vault);
  firstPeer.createProject("remote");
  stopAutoSave(firstPeer);
  await firstPeer.saveNow();
  const awaitedResult2 = await first.vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(awaitedResult2.status, "merged");
  assert.deepEqual(first.vault.getFavorites().projects, ["shared"]);

  const second = await createHarness(t);
  await seedProject(second.vault, "alpha");
  second.vault.createProject("beta");
  stopAutoSave(second.vault);
  await second.vault.saveNow();
  const secondPeer = await openPeer(second.directory);
  second.vault.toggleProjectFavorite("alpha");
  stopAutoSave(second.vault);
  secondPeer.toggleProjectFavorite("beta");
  stopAutoSave(secondPeer);
  await secondPeer.saveNow();
  const outcome = await second.vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(
    outcome.conflicts.some((item) => item.kind === "favorites"),
    true
  );
});

test("compatible histories merge, deduplicate, sort, and respect the cap", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const peer = await openPeer(directory);
  vault.maxHistoryVersions = 2;
  vault.setSecret(defaultTarget(vault, "shared"), "base", "current");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "base", "intermediate");
  peer.setSecret(defaultTarget(peer, "shared"), "base", "current");
  stopAutoSave(peer);
  await peer.saveNow();

  const awaitedResult3 = await vault.reconcileExternalChange({
    origin: "focus",
  });
  assert.equal(awaitedResult3.status, "merged");
  const { history } = vault.getSecretHistory(
    defaultTarget(vault, "shared"),
    "base"
  );
  assert.equal(history.length, 2);
  assert.equal(new Set(history.map((entry) => JSON.stringify(entry))).size, 2);
});

test("missing disk fails closed and only permits keeping the session", async (t) => {
  const { vault } = await createHarness(t);
  fs.unlinkSync(vault.vaultPath);
  const outcome = await vault.reconcileExternalChange({ origin: "focus" });
  assert.equal(outcome.reason, "disk_missing");
  assert.deepEqual(outcome.allowedDecisions, ["keep_session"]);
  await assert.rejects(
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    vault.resolveReconciliation({
      reconciliationId: outcome.reconciliationId,
      decision: "use_disk",
    }),
    { code: "VAULT_INVALID_RECONCILIATION_DECISION" }
  );
  assert.deepEqual(
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    await vault.resolveReconciliation({
      reconciliationId: outcome.reconciliationId,
      decision: "keep_session",
    }),
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    { status: "resolved", decision: "keep_session" }
  );
  assert.equal(fs.existsSync(vault.vaultPath), true);
});

test("untrusted disk data is never overwritten during detection", async (t) => {
  for (const kind of ["truncated", "wrong-key", "invalid-vault"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
    const { vault } = await createHarness(t);
    let bytes;
    if (kind === "truncated") {
      bytes = Buffer.from("not ciphertext");
    }
    if (kind === "wrong-key") {
      bytes = CryptoUtil.encryptJson(vault.data, crypto.randomBytes(32));
    }
    if (kind === "invalid-vault") {
      bytes = CryptoUtil.encryptJson(
        // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
        { version: "1.0.0", favorites: {} },
        vault.key
      );
    }
    fs.writeFileSync(vault.vaultPath, bytes);
    const before = fs.readFileSync(vault.vaultPath);
    // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
    const outcome = await vault.reconcileExternalChange({ origin: "focus" });
    assert.equal(
      outcome.reason,
      kind === "invalid-vault" ? "invalid_vault" : "disk_unreadable"
    );
    assert.deepEqual(outcome.allowedDecisions, ["keep_session"]);
    assert.deepEqual(fs.readFileSync(vault.vaultPath), before);
  }
});

test("session and disk changes supersede an inspected plan", async (t) => {
  const first = await createHarness(t);
  await seedProject(first.vault);
  const firstPeer = await openPeer(first.directory);
  first.vault.setSecret(
    defaultTarget(first.vault, "shared"),
    "base",
    "session"
  );
  stopAutoSave(first.vault);
  firstPeer.setSecret(defaultTarget(firstPeer, "shared"), "base", "disk");
  stopAutoSave(firstPeer);
  await firstPeer.saveNow();
  const sessionPlan = await first.vault.reconcileExternalChange({
    origin: "focus",
  });
  first.vault.setSecret(
    defaultTarget(first.vault, "shared"),
    "later",
    "change"
  );
  stopAutoSave(first.vault);
  assert.deepEqual(
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    await first.vault.resolveReconciliation({
      reconciliationId: sessionPlan.reconciliationId,
      decision: "use_disk",
    }),
    { status: "superseded" }
  );

  const second = await createHarness(t);
  await seedProject(second.vault);
  const secondPeer = await openPeer(second.directory);
  second.vault.setSecret(
    defaultTarget(second.vault, "shared"),
    "base",
    "session"
  );
  stopAutoSave(second.vault);
  secondPeer.setSecret(defaultTarget(secondPeer, "shared"), "base", "disk");
  stopAutoSave(secondPeer);
  await secondPeer.saveNow();
  const diskPlan = await second.vault.reconcileExternalChange({
    origin: "focus",
  });
  fs.writeFileSync(second.vault.vaultPath, Buffer.from("changed again"));
  assert.deepEqual(
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    await second.vault.resolveReconciliation({
      reconciliationId: diskPlan.reconciliationId,
      decision: "keep_session",
    }),
    { status: "superseded" }
  );
});

test("use_disk and keep_session apply the exact inspected side", async (t) => {
  const first = await createHarness(t);
  await seedProject(first.vault);
  const firstPeer = await openPeer(first.directory);
  first.vault.setSecret(
    defaultTarget(first.vault, "shared"),
    "base",
    "session"
  );
  stopAutoSave(first.vault);
  firstPeer.setSecret(defaultTarget(firstPeer, "shared"), "base", "disk");
  stopAutoSave(firstPeer);
  await firstPeer.saveNow();
  const useDiskPlan = await first.vault.reconcileExternalChange({
    origin: "focus",
  });
  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  await first.vault.resolveReconciliation({
    reconciliationId: useDiskPlan.reconciliationId,
    decision: "use_disk",
  });
  assert.equal(
    first.vault.getSecret(defaultTarget(first.vault, "shared"), "base").value,
    "disk"
  );

  const second = await createHarness(t);
  await seedProject(second.vault);
  const secondPeer = await openPeer(second.directory);
  second.vault.setSecret(
    defaultTarget(second.vault, "shared"),
    "base",
    "session"
  );
  stopAutoSave(second.vault);
  secondPeer.setSecret(defaultTarget(secondPeer, "shared"), "base", "disk");
  stopAutoSave(secondPeer);
  await secondPeer.saveNow();
  const keepSessionPlan = await second.vault.reconcileExternalChange({
    origin: "focus",
  });
  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  await second.vault.resolveReconciliation({
    reconciliationId: keepSessionPlan.reconciliationId,
    decision: "keep_session",
  });
  assert.equal(
    await readSecretFromDisk(second.directory, "shared", "base"),
    "session"
  );
});

test("unknown and reused reconciliation IDs fail closed", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  await assert.rejects(
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    vault.resolveReconciliation({
      reconciliationId: "unknown",
      decision: "keep_session",
    }),
    { code: "VAULT_INVALID_RECONCILIATION_PLAN" }
  );
  const peer = await openPeer(directory);
  vault.setSecret(defaultTarget(vault, "shared"), "base", "session");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "base", "disk");
  stopAutoSave(peer);
  await peer.saveNow();
  const outcome = await vault.reconcileExternalChange({ origin: "focus" });
  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  await vault.resolveReconciliation({
    reconciliationId: outcome.reconciliationId,
    decision: "use_disk",
  });
  await assert.rejects(
    // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
    vault.resolveReconciliation({
      reconciliationId: outcome.reconciliationId,
      decision: "use_disk",
    }),
    { code: "VAULT_INVALID_RECONCILIATION_PLAN" }
  );
});

test("save routes stale disk state through reconciliation and emits one safe outcome", async (t) => {
  const notifications: { status: string; reconciliationId?: string }[] = [];
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-reconcile-save-")
  );
  // oxlint-disable-next-line eslint/sort-keys -- Preserve the established fixture and harness property insertion order.
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const vault = new Vault(directory, {
    onConflict: (outcome) => notifications.push(outcome),
  });
  await vault.setup(PASSWORD);
  await seedProject(vault);
  const peer = await openPeer(directory);
  vault.setSecret(defaultTarget(vault, "shared"), "base", "session-raw-value");
  stopAutoSave(vault);
  peer.setSecret(defaultTarget(peer, "shared"), "base", "disk-raw-value");
  stopAutoSave(peer);
  await peer.saveNow();

  await assert.rejects(vault.saveNow(), {
    code: "VAULT_RECONCILIATION_REQUIRED",
  });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].status, "needs_resolution");
  assert.equal(
    JSON.stringify(notifications[0]).includes("session-raw-value"),
    false
  );

  const repeated = await vault.reconcileExternalChange({ origin: "periodic" });
  assert.equal(repeated.reconciliationId, notifications[0].reconciliationId);
  assert.equal(notifications.length, 1);
});

test("an external write during the atomic-save window is preserved", async (t) => {
  const { vault } = await createHarness(t);
  await seedProject(vault);
  vault.setSecret(defaultTarget(vault, "shared"), "local", "session-value");
  stopAutoSave(vault);

  const externalBytes = Buffer.from("external-write-during-save");
  const originalWriteFile = fs.promises.writeFile;
  let injected = false;
  fs.promises.writeFile = async function writeFile(file, ...args) {
    const result = await Reflect.apply(originalWriteFile, this, [
      file,
      ...args,
    ]);
    if (
      !injected &&
      String(file).startsWith(`${vault.vaultPath}.`) &&
      String(file).endsWith(".tmp")
    ) {
      injected = true;
      fs.writeFileSync(vault.vaultPath, externalBytes);
    }
    return result;
  };

  try {
    await assert.rejects(vault.saveNow(), {
      code: "VAULT_RECONCILIATION_REQUIRED",
    });
  } finally {
    fs.promises.writeFile = originalWriteFile;
  }

  assert.equal(injected, true);
  assert.deepEqual(fs.readFileSync(vault.vaultPath), externalBytes);
});

test("password-change failure restores the original decryptable vault", async (t) => {
  const { directory, vault } = await createHarness(t);
  await seedProject(vault);
  const previousVaultBytes = fs.readFileSync(vault.vaultPath);
  const previousSalt = fs.readFileSync(vault.saltPath);
  const originalWriteFile = fs.promises.writeFile;
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  fs.promises.writeFile = async function writeFile(file, ...args) {
    if (
      String(file).startsWith(`${vault.saltPath}.`) &&
      String(file).endsWith(".tmp")
    ) {
      throw new Error("injected salt write failure");
    }
    return Reflect.apply(originalWriteFile, this, [file, ...args]);
  };

  try {
    await assert.rejects(
      vault.changePassword(PASSWORD, "replacement-password"),
      /injected salt write failure/u
    );
  } finally {
    fs.promises.writeFile = originalWriteFile;
  }

  assert.deepEqual(fs.readFileSync(vault.vaultPath), previousVaultBytes);
  assert.deepEqual(fs.readFileSync(vault.saltPath), previousSalt);

  const oldPasswordReader = new Vault(directory);
  await oldPasswordReader.unlock(PASSWORD);
  assert.equal(
    oldPasswordReader.getSecret(
      defaultTarget(oldPasswordReader, "shared"),
      "base"
    ).value,
    "one"
  );

  const newPasswordReader = new Vault(directory);
  await assert.rejects(newPasswordReader.unlock("replacement-password"));
});
