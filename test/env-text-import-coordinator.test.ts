const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");
const EnvTextImportCoordinator = require("../src/modules/env-text-import-coordinator");

const PASSWORD = "env-import-integration-password";

/** Real default Environment target; the coordinator never accepts a bare Project name. */
// oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
const defaultTarget = async (session, projectName) =>
  session.withActiveSession(({ activeVault }) =>
    activeVault.resolveEnvironmentTarget({ projectName })
  );

const createRuntime = (directory) => {
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
  return { session, vaultManager };
};

test("reviewed text import previews masked metadata and commits through a real VaultSession", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");

  const coordinator = new EnvTextImportCoordinator({ session });
  const preview = await coordinator.preview(target, {
    content: "API_TOKEN=first\nEMPTY=''\n",
    source: "text",
  });
  assert.equal(preview.success, true);
  assert.equal(JSON.stringify(preview).includes("first"), false);
  assert.deepEqual(
    preview.entries.map(({ key, occurrences }) => ({
      defaultAction: occurrences[0].defaultAction,
      key,
      status: occurrences[0].status,
    })),
    [
      { defaultAction: "add", key: "API_TOKEN", status: "new" },
      { defaultAction: "skip", key: "EMPTY", status: "new" },
    ]
  );

  assert.deepEqual(
    await coordinator.reveal(
      preview.handle,
      "API_TOKEN",
      preview.entries[0].occurrences[0].id
    ),
    {
      success: true,
      value: "first",
    }
  );
  const committed = await coordinator.commit(preview.handle, [
    {
      action: "add",
      key: "API_TOKEN",
      occurrenceId: preview.entries[0].occurrences[0].id,
    },
    {
      action: "skip",
      key: "EMPTY",
      occurrenceId: preview.entries[1].occurrences[0].id,
    },
  ]);
  assert.equal(committed.success, true);
  assert.deepEqual(
    {
      added: committed.added,
      replaced: committed.replaced,
      skipped: committed.skipped,
    },
    { added: 1, replaced: 0, skipped: 1 }
  );

  await session.close({ reason: "manual" });
  const reopened = createRuntime(directory);
  await reopened.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  const saved = await reopened.session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "API_TOKEN")
  );
  assert.equal(saved.value, "first");
  await reopened.session.close({ reason: "manual" });
});

test("text and file sources share bounded parsing without expanding shell-like values", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-sources-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");

  const source =
    // oxlint-disable-next-line eslint/no-template-curly-in-string -- Literal interpolation syntax is input data for the environment parser.
    '\uFEFF```dotenv\r\nexport EQUALS=one=two # trailing comment\r\nDOUBLE="first\\nsecond\\tend\\\\"\r\nSINGLE=\'first\r\nsecond\'\r\nSINGLE_SLASH=\'path\\q\'\r\nUNKNOWN="path\\q"\r\nHASH=token#literal\r\nINLINE=abc\'xyz\r\nURL=https://host?q="x"\r\nCOMMAND=$(touch should-not-exist)\r\nREFERENCE=${KEYHARBOR:service:SECRET}\r\n```\r\n';
  const expected = {
    COMMAND: "$(touch should-not-exist)",
    DOUBLE: "first\nsecond\tend\\",
    EQUALS: "one=two",
    HASH: "token#literal",
    INLINE: "abc'xyz",
    // oxlint-disable-next-line eslint/no-template-curly-in-string -- Literal interpolation syntax is input data for the environment parser.
    REFERENCE: "${KEYHARBOR:service:SECRET}",
    SINGLE: "first\nsecond",
    SINGLE_SLASH: "path\\q",
    UNKNOWN: "path\\q",
    URL: 'https://host?q="x"',
  };
  const filePath = path.join(directory, "input.env");
  fs.writeFileSync(filePath, source, "utf-8");
  const coordinator = new EnvTextImportCoordinator({ session });
  const pasted = await coordinator.preview(target, {
    content: source,
    source: "text",
  });
  const fromFile = await coordinator.preview(target, {
    filePath,
    source: "file",
  });
  assert.equal(pasted.success, true);
  assert.equal(fromFile.success, true);
  assert.deepEqual(
    pasted.entries.map(({ key, occurrences }) => [key, occurrences[0].line]),
    fromFile.entries.map(({ key, occurrences }) => [key, occurrences[0].line])
  );
  assert.equal(JSON.stringify(fromFile).includes("should-not-exist"), false);
  for (const [key, value] of Object.entries(expected)) {
    const [occurrence] = pasted.entries.find(
      (entry) => entry.key === key
    ).occurrences;
    assert.deepEqual(
      // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
      await coordinator.reveal(pasted.handle, key, occurrence.id),
      { success: true, value }
    );
  }
  const decisions = pasted.entries.map(({ key, occurrences }) => ({
    action: "add",
    key,
    occurrenceId: occurrences[0].id,
  }));
  const awaitedResult1 = await coordinator.commit(pasted.handle, decisions);
  assert.equal(awaitedResult1.success, true);
  const saved = await session.withActiveSession(({ activeVault }) =>
    Object.fromEntries(
      Object.keys(expected).map((key) => [
        key,
        activeVault.getSecret(target, key).value,
      ])
    )
  );
  assert.deepEqual(saved, expected);

  fs.writeFileSync(
    path.join(directory, "oversized.env"),
    Buffer.alloc(1024 * 1024 + 1, 0x41)
  );
  const awaitedResult2 = await coordinator.preview(target, {
    filePath: path.join(directory, "oversized.env"),
    source: "file",
  });
  assert.equal(awaitedResult2.code, "IMPORT_INPUT_TOO_LARGE");
  const awaitedResult3 = await coordinator.preview(target, {
    filePath: directory,
    source: "file",
  });
  assert.equal(awaitedResult3.code, "IMPORT_INVALID_FILE");
  const awaitedResult4 = await coordinator.preview(target, {
    content: "A".repeat(1024 * 1024 + 1),
    source: "text",
  });
  assert.equal(awaitedResult4.code, "IMPORT_INPUT_TOO_LARGE");
  const tooManyAssignments = `${Array.from({ length: 5001 }, (_, index) => `KEY_${index}=x`).join("\n")}\n`;
  const tooMany = await coordinator.preview(target, {
    content: tooManyAssignments,
    source: "text",
  });
  assert.equal(tooMany.diagnostics[0].code, "too_many_assignments");
  const maximumAssignments = `${Array.from({ length: 5000 }, (_, index) => `LIMIT_${index}=x`).join("\n")}\n`;
  const atLimit = await coordinator.preview(target, {
    content: maximumAssignments,
    source: "text",
  });
  assert.equal(atLimit.entries.length, 5000);
  await coordinator.discard(atLimit.handle);
  const multibyteOverLimit = "😀".repeat(262_145);
  const awaitedResult5 = await coordinator.preview(target, {
    content: multibyteOverLimit,
    source: "text",
  });
  assert.equal(awaitedResult5.code, "IMPORT_INPUT_TOO_LARGE");
  for (const [content, diagnostic] of [
    ['SECRET="quoted-value"tail', "trailing_material"],
    ["```bash\nSECRET=quoted-value\n```", "unsupported_fence"],
    ['SECRET="unterminated-value', "unterminated_quote"],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
    const result = await coordinator.preview(target, {
      content,
      source: "text",
    });
    assert.equal(result.diagnostics[0].code, diagnostic);
    assert.equal(JSON.stringify(result).includes("quoted-value"), false);
  }
  await session.close({ reason: "manual" });
});

test("duplicate occurrences require a choice and prototype-like keys remain ordinary Secrets", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-keys-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");
  const coordinator = new EnvTextImportCoordinator({ session });

  const duplicate = await coordinator.preview(target, {
    content: "DUP=first\nDUP=second\n",
    source: "text",
  });
  assert.equal(duplicate.entries[0].duplicate, true);
  const awaitedResult6 = await coordinator.commit(duplicate.handle, [
    { action: "add", key: "DUP", occurrenceId: null },
  ]);
  assert.equal(awaitedResult6.code, "IMPORT_INVALID_SELECTION");
  const applied = await coordinator.commit(duplicate.handle, [
    {
      action: "add",
      key: "DUP",
      occurrenceId: duplicate.entries[0].occurrences[1].id,
    },
  ]);
  assert.equal(applied.added, 1);
  const awaitedResult7 = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "DUP")
  );
  assert.equal(awaitedResult7.value, "second");

  const prototypeKeys = await coordinator.preview(target, {
    content: "__proto__=prototype-value\nconstructor=constructor-value\n",
    source: "text",
  });
  const choices = prototypeKeys.entries.map(({ key, occurrences }) => ({
    action: "add",
    key,
    occurrenceId: occurrences[0].id,
  }));
  const awaitedResult8 = await coordinator.commit(
    prototypeKeys.handle,
    choices
  );
  assert.equal(awaitedResult8.added, 2);
  const values = await session.withActiveSession(({ activeVault }) => [
    activeVault.getSecret(target, "__proto__").value,
    activeVault.getSecret(target, "constructor").value,
  ]);
  assert.deepEqual(values, ["prototype-value", "constructor-value"]);
  await session.close({ reason: "manual" });
});

test("prototype-like Secret keys survive saves and a later import", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-prototype-persist-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("probe")
  );
  const target = await defaultTarget(session, "probe");
  const coordinator = new EnvTextImportCoordinator({ session });
  const importOne = await coordinator.preview(target, {
    content: "__proto__=preserve-me",
    source: "text",
  });
  const awaitedResult9 = await coordinator.commit(importOne.handle, [
    {
      action: "add",
      key: "__proto__",
      occurrenceId: importOne.entries[0].occurrences[0].id,
    },
  ]);
  assert.equal(awaitedResult9.success, true);
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());

  const importTwo = await coordinator.preview(target, {
    content: "OTHER=new-value",
    source: "text",
  });
  const awaitedResult10 = await coordinator.commit(importTwo.handle, [
    {
      action: "add",
      key: "OTHER",
      occurrenceId: importTwo.entries[0].occurrences[0].id,
    },
  ]);
  assert.equal(awaitedResult10.success, true);
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());
  const saved = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecrets(target)
  );
  assert.equal(Object.hasOwn(saved, "__proto__"), true);
  // oxlint-disable-next-line eslint/no-proto -- This fixture verifies that an own __proto__ key cannot mutate the prototype.
  assert.equal(saved.__proto__.value, "preserve-me");

  await session.close({ reason: "manual" });
  const reopened = createRuntime(directory);
  await reopened.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  const afterReopen = await reopened.session.withActiveSession(
    ({ activeVault }) => activeVault.getSecrets(target)
  );
  assert.equal(Object.hasOwn(afterReopen, "__proto__"), true);
  // oxlint-disable-next-line eslint/no-proto -- This fixture verifies that an own __proto__ key cannot mutate the prototype.
  assert.equal(afterReopen.__proto__.value, "preserve-me");
  assert.equal(afterReopen.OTHER.value, "new-value");
  await reopened.session.close({ reason: "manual" });
});

test("empty saved Projects accept inherited-name Secrets and retain them across imports and reopen", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-inherited-names-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(async ({ activeVault }) => {
    await activeVault.createProject("probe");
    await activeVault.saveNow();
  });
  const target = await defaultTarget(session, "probe");
  const coordinator = new EnvTextImportCoordinator({ session });

  const first = await coordinator.preview(target, {
    content: "constructor=synthetic-value\n__proto__=other-value",
    source: "text",
  });
  assert.equal(first.success, true);
  assert.deepEqual(
    first.entries.map(({ key }) => key),
    ["constructor", "__proto__"]
  );
  const awaitedResult11 = await coordinator.commit(
    first.handle,
    first.entries.map(({ key, occurrences }) => ({
      action: "add",
      key,
      occurrenceId: occurrences[0].id,
    }))
  );
  assert.equal(awaitedResult11.success, true);
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());

  const later = await coordinator.preview(target, {
    content: "LATER=retained",
    source: "text",
  });
  assert.equal(later.success, true);
  const awaitedResult12 = await coordinator.commit(later.handle, [
    {
      action: "add",
      key: "LATER",
      occurrenceId: later.entries[0].occurrences[0].id,
    },
  ]);
  assert.equal(awaitedResult12.success, true);
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());
  await session.close({ reason: "manual" });

  const reopened = createRuntime(directory);
  await reopened.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  const secrets = await reopened.session.withActiveSession(({ activeVault }) =>
    activeVault.getSecrets(target)
  );
  for (const [key, value] of [
    ["constructor", "synthetic-value"],
    ["__proto__", "other-value"],
    ["LATER", "retained"],
  ]) {
    assert.equal(
      Object.hasOwn(secrets, key),
      true,
      `${key} must remain an own Secret key`
    );
    assert.equal(secrets[key].value, value);
  }
  // A target naming an inherited-name Project must not resolve to another collection.
  const inheritedProject = await new EnvTextImportCoordinator({
    session: reopened.session,
  }).preview(
    { environmentId: "nonexistent", projectName: "constructor" },
    { content: "A=x", source: "text" }
  );
  assert.equal(inheritedProject.success, false);
  assert.equal(inheritedProject.code, "IMPORT_TARGET_UNAVAILABLE");
  // A bare Project name is not a valid review target at all.
  const bareProject = await new EnvTextImportCoordinator({
    session: reopened.session,
  }).preview("constructor", { content: "A=x", source: "text" });
  assert.equal(bareProject.success, false);
  assert.equal(bareProject.code, "IMPORT_INVALID_TARGET");
  await reopened.session.close({ reason: "manual" });
});

test("commit accepts unrelated Secret edits, preserves replacement context, and rejects stale targets", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-stale-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) => {
    activeVault.createProject("service");
    activeVault.setSecret(
      activeVault.resolveEnvironmentTarget({ projectName: "service" }),
      "EXISTING",
      "old-value",
      "2030-01-01T00:00:00.000Z",
      { description: "keep this", tags: ["prod"] }
    );
  });
  const target = await defaultTarget(session, "service");
  const coordinator = new EnvTextImportCoordinator({ session });
  const preview = await coordinator.preview(target, {
    content: "EXISTING=new-value\nADDED=fresh\n",
    source: "text",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(target, "UNRELATED", "other")
  );
  const committed = await coordinator.commit(
    preview.handle,
    preview.entries.map(({ key, occurrences }) => ({
      action: key === "EXISTING" ? "replace" : "add",
      key,
      occurrenceId: occurrences[0].id,
    }))
  );
  assert.deepEqual(
    { added: committed.added, replaced: committed.replaced },
    { added: 1, replaced: 1 }
  );
  const replacement = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "EXISTING")
  );
  assert.equal(replacement.value, "new-value");
  assert.equal(replacement.expiresAt, "2030-01-01T00:00:00.000Z");
  assert.equal(replacement.description, "keep this");
  assert.deepEqual(replacement.tags, ["prod"]);
  const history = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecretHistory(target, "EXISTING")
  );
  assert.equal(history.history[0].value, "old-value");

  const staleSecret = await coordinator.preview(target, {
    content: "EXISTING=preview-value\n",
    source: "text",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(target, "EXISTING", "concurrent-value")
  );
  const stale = await coordinator.commit(staleSecret.handle, [
    {
      action: "replace",
      key: "EXISTING",
      occurrenceId: staleSecret.entries[0].occurrences[0].id,
    },
  ]);
  assert.equal(stale.code, "IMPORT_STALE");
  assert.equal(JSON.stringify(stale).includes("preview-value"), false);

  const captured = await coordinator.captureTarget(target);
  await session.withActiveSession(({ activeVault }) => {
    activeVault.deleteProject("service");
    activeVault.createProject("service");
  });
  const bound = await coordinator.preview(
    target,
    { content: "NEW=value", source: "text" },
    captured.binding
  );
  assert.equal(bound.code, "IMPORT_STALE");
  await session.close({ reason: "manual" });
});

test("invalid diagnostics and choices never echo values or apply a partial batch", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-errors-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");
  const coordinator = new EnvTextImportCoordinator({ session });

  const malformed = await coordinator.preview(target, {
    content: "SECRET_VALUE=do-not-echo\nunsupported prose",
    source: "text",
  });
  assert.equal(malformed.handle, null);
  assert.equal(JSON.stringify(malformed).includes("do-not-echo"), false);
  const awaitedResult13 = await coordinator.preview(target, {
    content: "SECRET=x\u0000y",
    source: "text",
  });
  assert.equal(awaitedResult13.diagnostics[0].code, "nul_character");

  const review = await coordinator.preview(target, {
    content: "GOOD=good-value\nOTHER=other-value\n",
    source: "text",
  });
  const invalid = await coordinator.commit(
    review.handle,
    review.entries.map(({ key, occurrences }) => ({
      action: key === "GOOD" ? "add" : "replace",
      key,
      occurrenceId: occurrences[0].id,
    }))
  );
  assert.equal(invalid.code, "IMPORT_INVALID_SELECTION");
  const stillAbsent = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecrets(target)
  );
  assert.equal(Object.hasOwn(stillAbsent, "GOOD"), false);
  assert.equal(Object.hasOwn(stillAbsent, "OTHER"), false);
  assert.equal(JSON.stringify(invalid).includes("good-value"), false);

  const consumed = await coordinator.preview(target, {
    content: "ONCE=value",
    source: "text",
  });
  const decision = [
    {
      action: "skip",
      key: "ONCE",
      occurrenceId: consumed.entries[0].occurrences[0].id,
    },
  ];
  const awaitedResult14 = await coordinator.commit(consumed.handle, decision);
  assert.equal(awaitedResult14.success, true);
  const awaitedResult15 = await coordinator.commit(consumed.handle, decision);
  assert.equal(awaitedResult15.code, "IMPORT_PREVIEW_INVALID");
  await session.close({ reason: "manual" });
});

test("session lock, closing, explicit clear, and Vault switching retire exposed review handles", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-lifecycle-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");
  const coordinator = new EnvTextImportCoordinator({ session });

  const switched = await coordinator.preview(target, {
    content: "SWITCHED=value",
    source: "text",
  });
  const secondaryDirectory = path.join(directory, "secondary-folder");
  fs.mkdirSync(secondaryDirectory);
  await session.withActiveSession(({ vaults }) =>
    vaults.create("secondary", secondaryDirectory, PASSWORD)
  );
  const secondaryId = session.vaultManager
    .getVaultList()
    .find(({ name }) => name === "secondary").id;
  await session.withActiveSession(({ vaults }) => vaults.switch(secondaryId));
  const switchedResult = await coordinator.commit(switched.handle, [
    {
      action: "add",
      key: "SWITCHED",
      occurrenceId: switched.entries[0].occurrences[0].id,
    },
  ]);
  assert.equal(switchedResult.code, "IMPORT_STALE");
  await session.withActiveSession(({ vaults }) => vaults.switch("system"));

  const locked = await coordinator.preview(target, {
    content: "LOCKED=value",
    source: "text",
  });
  await session.close({ reason: "manual" });
  const lockedReveal = await coordinator.reveal(
    locked.handle,
    "LOCKED",
    locked.entries[0].occurrences[0].id
  );
  assert.equal(lockedReveal.code, "VAULT_SESSION_LOCKED");
  await session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  const awaitedResult16 = await coordinator.reveal(
    locked.handle,
    "LOCKED",
    locked.entries[0].occurrences[0].id
  );
  assert.equal(awaitedResult16.code, "IMPORT_PREVIEW_INVALID");

  const closingPreview = await coordinator.preview(target, {
    content: "CLOSING=value",
    source: "text",
  });
  let releaseLease;
  const blocker = session.withActiveSession(
    () =>
      // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
      new Promise((resolve) => {
        releaseLease = resolve;
      })
  );
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  const closePromise = session.close({ reason: "manual" });
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(session.snapshot().state, "closing");
  const closingReveal = await coordinator.reveal(
    closingPreview.handle,
    "CLOSING",
    closingPreview.entries[0].occurrences[0].id
  );
  assert.equal(closingReveal.code, "VAULT_SESSION_CLOSING");
  releaseLease();
  await blocker;
  await closePromise;

  assert.deepEqual(await coordinator.discard(closingPreview.handle), {
    success: true,
  });
  assert.deepEqual(await coordinator.discard(closingPreview.handle), {
    success: true,
  });
  await session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  const cleared = await coordinator.preview(target, {
    content: "CLEARED=value",
    source: "text",
  });
  coordinator.clear();
  const awaitedResult17 = await coordinator.reveal(
    cleared.handle,
    "CLEARED",
    cleared.entries[0].occurrences[0].id
  );
  assert.equal(awaitedResult17.code, "IMPORT_PREVIEW_INVALID");
});

test("clearing a pending file preview and discarding its target binding prevents late review", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-late-file-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");
  const coordinator = new EnvTextImportCoordinator({ session });
  const filePath = path.join(directory, "late.env");
  fs.writeFileSync(filePath, "LATE=private-value", "utf-8");

  const pendingClear = coordinator.preview(target, {
    filePath,
    source: "file",
  });
  coordinator.clear();
  const awaitedResult18 = await pendingClear;
  assert.equal(awaitedResult18.code, "IMPORT_PREVIEW_INVALID");

  const { binding } = await coordinator.captureTarget(target);
  const pendingDiscard = coordinator.preview(
    target,
    { filePath, source: "file" },
    binding
  );
  await coordinator.discard(binding);
  const discarded = await pendingDiscard;
  assert.equal(discarded.code, "IMPORT_STALE");
  assert.equal(JSON.stringify(discarded).includes("private-value"), false);
  await session.close({ reason: "manual" });
});

test("an import concurrent with an in-flight save is included in the persisted Vault", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-save-race-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("service")
  );
  const target = await defaultTarget(session, "service");
  const coordinator = new EnvTextImportCoordinator({ session });
  const preview = await coordinator.preview(target, {
    content: "RACED=preserved",
    source: "text",
  });

  const originalWriteFile = fs.promises.writeFile;
  let started!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  const writeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pauseNextVaultWrite = true;
  fs.promises.writeFile = async (...args) => {
    if (pauseNextVaultWrite && String(args[0]).includes("vault-v2.enc.")) {
      pauseNextVaultWrite = false;
      started();
      await writeGate;
    }
    return originalWriteFile(...args);
  };
  t.after(() => {
    fs.promises.writeFile = originalWriteFile;
  });

  const pendingSave = session.withActiveSession(({ activeVault }) =>
    activeVault.saveNow()
  );
  await writeStarted;
  const pendingCommit = coordinator.commit(preview.handle, [
    {
      action: "add",
      key: "RACED",
      occurrenceId: preview.entries[0].occurrences[0].id,
    },
  ]);
  const saveAfterImport = session.withActiveSession(({ activeVault }) =>
    activeVault.saveNow()
  );
  release();
  const [committed] = await Promise.all([pendingCommit, pendingSave]);
  assert.equal(committed.success, true);
  await saveAfterImport;
  await session.close({ reason: "manual" });

  const reopened = createRuntime(directory);
  await reopened.session.open({
    credential: PASSWORD,
    method: "password",
    reason: "manual",
  });
  const raced = await reopened.session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "RACED")
  );
  assert.equal(raced.value, "preserved");
  await reopened.session.close({ reason: "manual" });
});

test("a queued commit revalidates session target, clear generation, and relevant Secrets at apply time", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-env-import-queued-check-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const { session } = createRuntime(directory);
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) =>
    activeVault.createProject("probe")
  );
  const target = await defaultTarget(session, "probe");
  const secondaryDirectory = path.join(directory, "secondary-folder");
  fs.mkdirSync(secondaryDirectory);
  await session.withActiveSession(({ vaults }) =>
    vaults.create("secondary", secondaryDirectory, PASSWORD)
  );
  const secondaryId = session.vaultManager
    .getVaultList()
    .find(({ name }) => name === "secondary").id;
  const coordinator = new EnvTextImportCoordinator({ session });

  const originalWriteFile = fs.promises.writeFile;
  const nextGate: {
    current: { started: () => void; block: Promise<void> } | null;
  } = { current: null };
  fs.promises.writeFile = async (...args) => {
    if (nextGate.current && String(args[0]).includes("vault-v2.enc.")) {
      const gate = nextGate.current;
      nextGate.current = null;
      gate.started();
      await gate.block;
    }
    return originalWriteFile(...args);
  };
  t.after(() => {
    fs.promises.writeFile = originalWriteFile;
  });
  const pauseSave = async () => {
    let started!: () => void;
    let release!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    nextGate.current = { block, started };
    const save = session.withActiveSession(({ activeVault }) =>
      activeVault.saveNow()
    );
    await startedPromise;
    return { release, save };
  };
  const releaseExpectedRevisionSave = async (save) => {
    await assert.rejects(
      save,
      (error) => error.code === "VAULT_REVISION_CHANGED"
    );
  };

  const switchPreview = await coordinator.preview(target, {
    content: "SWITCH=value",
    source: "text",
  });
  const switchGate = await pauseSave();
  const pendingSwitchCommit = coordinator.commit(switchPreview.handle, [
    {
      action: "add",
      key: "SWITCH",
      occurrenceId: switchPreview.entries[0].occurrences[0].id,
    },
  ]);
  await session.withActiveSession(({ vaults }) => vaults.switch(secondaryId));
  switchGate.release();
  await switchGate.save;
  const awaitedResult19 = await pendingSwitchCommit;
  assert.equal(awaitedResult19.code, "IMPORT_STALE");
  await session.withActiveSession(({ vaults }) => vaults.switch("system"));
  const afterSwitch = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecrets(target)
  );
  assert.equal(Object.hasOwn(afterSwitch, "SWITCH"), false);

  const clearPreview = await coordinator.preview(target, {
    content: "CLEARED=value",
    source: "text",
  });
  const clearGate = await pauseSave();
  const pendingClearCommit = coordinator.commit(clearPreview.handle, [
    {
      action: "add",
      key: "CLEARED",
      occurrenceId: clearPreview.entries[0].occurrences[0].id,
    },
  ]);
  coordinator.clear();
  clearGate.release();
  await clearGate.save;
  const awaitedResult20 = await pendingClearCommit;
  assert.equal(awaitedResult20.code, "IMPORT_PREVIEW_INVALID");

  await session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(target, "RELEVANT", "before")
  );
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());
  const relevantPreview = await coordinator.preview(target, {
    content: "RELEVANT=incoming",
    source: "text",
  });
  const relevantGate = await pauseSave();
  const pendingRelevantCommit = coordinator.commit(relevantPreview.handle, [
    {
      action: "replace",
      key: "RELEVANT",
      occurrenceId: relevantPreview.entries[0].occurrences[0].id,
    },
  ]);
  await session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(target, "RELEVANT", "changed-after-preview")
  );
  relevantGate.release();
  await releaseExpectedRevisionSave(relevantGate.save);
  const awaitedResult21 = await pendingRelevantCommit;
  assert.equal(awaitedResult21.code, "IMPORT_STALE");
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());
  const awaitedResult22 = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecret(target, "RELEVANT")
  );
  assert.equal(awaitedResult22.value, "changed-after-preview");

  const unrelatedPreview = await coordinator.preview(target, {
    content: "UNRELATED_SAFE=accepted",
    source: "text",
  });
  const unrelatedGate = await pauseSave();
  const pendingUnrelatedCommit = coordinator.commit(unrelatedPreview.handle, [
    {
      action: "add",
      key: "UNRELATED_SAFE",
      occurrenceId: unrelatedPreview.entries[0].occurrences[0].id,
    },
  ]);
  await session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(target, "OTHER", "independent")
  );
  unrelatedGate.release();
  await releaseExpectedRevisionSave(unrelatedGate.save);
  const awaitedResult23 = await pendingUnrelatedCommit;
  assert.equal(awaitedResult23.success, true);
  await session.withActiveSession(({ activeVault }) => activeVault.saveNow());
  const finalSecrets = await session.withActiveSession(({ activeVault }) =>
    activeVault.getSecrets(target)
  );
  assert.equal(finalSecrets.UNRELATED_SAFE.value, "accepted");
  assert.equal(finalSecrets.OTHER.value, "independent");
  await session.close({ reason: "manual" });
});
