const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");

const harness = (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-recovery-store-")
  );
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return {
    key: crypto.randomBytes(32),
    root,
    store: new VaultRecoveryStore(path.join(root, "recovery")),
  };
};

const write = (store, key) =>
  store.writeCapsule({
    artifactId: "system",
    generation: 1,
    key,
    kind: "vault",
    payload: {
      currentRevision: 2,
      sessionData: {
        projects: { example: { secrets: { token: "plaintext-secret" } } },
      },
    },
    vaultId: "system",
    vaultInstanceId: crypto.randomBytes(32).toString("hex"),
    vaultPath: "/tmp/example-vault/vault.enc",
  });

test("recovery capsules authenticate header identity and conceal plaintext", (t) => {
  const { store, key } = harness(t);
  const header = write(store, key);
  const target = path.join(store.directory, `${header.capsuleId}.capsule`);
  assert.equal(
    fs.readFileSync(target).includes(Buffer.from("plaintext-secret")),
    false
  );
  assert.deepEqual(
    store.listHeaders().map((item) => item.capsuleId),
    [header.capsuleId]
  );
  const recovered = store.readCapsule(header.capsuleId, key);
  assert.equal(
    recovered.payload.sessionData.projects.example.secrets.token,
    "plaintext-secret"
  );
});

test("wrong keys and tampered headers fail authentication", (t) => {
  const { store, key } = harness(t);
  const header = write(store, key);
  assert.throws(
    () => store.readCapsule(header.capsuleId, crypto.randomBytes(32)),
    (failure) => failure.code === "VAULT_RECOVERY_AUTH_FAILED"
  );

  const target = path.join(store.directory, `${header.capsuleId}.capsule`);
  const envelope = JSON.parse(fs.readFileSync(target, "utf-8"));
  envelope.header.artifactId = "different";
  fs.writeFileSync(target, JSON.stringify(envelope));
  assert.throws(
    () => store.readCapsule(header.capsuleId, key),
    (failure) => failure.code === "VAULT_RECOVERY_AUTH_FAILED"
  );
});

test("symlink records are rejected", (t) => {
  const { root, store } = harness(t);
  store.ensureDirectory();
  const capsuleId = "a".repeat(32);
  const outside = path.join(root, "outside");
  fs.writeFileSync(outside, "{}");
  fs.symlinkSync(outside, path.join(store.directory, `${capsuleId}.capsule`));
  assert.throws(
    () => store.readCapsule(capsuleId, crypto.randomBytes(32)),
    (failure) => failure.code === "VAULT_RECOVERY_UNSAFE_PATH"
  );
});
