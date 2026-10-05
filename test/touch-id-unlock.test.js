const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TouchIdUnlock = require("../src/modules/touch-id-unlock");

const createHarness = (platform = "darwin") => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-touch-id-")
  );
  const credentialPath = path.join(directory, "touch-id-key.enc");
  const prompts = [];
  const systemPreferences = {
    canPromptTouchID: () => true,
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    promptTouchID: async (reason) => prompts.push(reason),
  };
  const safeStorage = {
    decryptString: (value) => value.toString("utf-8").replace(/^wrapped:/u, ""),
    encryptString: (value) => Buffer.from(`wrapped:${value}`, "utf-8"),
    isEncryptionAvailable: () => true,
  };
  const touchId = new TouchIdUnlock({
    credentialPath,
    platform,
    safeStorage,
    systemPreferences,
  });

  return {
    cleanup: () => fs.rmSync(directory, { force: true, recursive: true }),
    credentialPath,
    prompts,
    touchId,
  };
};

test("Touch ID availability is limited to supported Macs", (t) => {
  const mac = createHarness();
  const windows = createHarness("win32");
  t.after(mac.cleanup);
  t.after(windows.cleanup);

  assert.equal(mac.touchId.isAvailable(), true);
  assert.equal(windows.touchId.isAvailable(), false);
});

test("enabling Touch ID authenticates before storing a wrapped vault key", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  const key = Buffer.alloc(32, 7);

  await harness.touchId.enable(key);

  assert.deepEqual(harness.prompts, ["enable Touch ID unlock for KeyHarbor"]);
  assert.equal(harness.touchId.hasCredential(), true);
  // Compare POSIX permission bits independently of the file type bits.
  // eslint-disable-next-line no-bitwise
  assert.equal(fs.statSync(harness.credentialPath).mode & 0o777, 0o600);
  assert.equal(harness.touchId.getStatus(true).enabled, true);
});

test("unlocking authenticates before returning the saved vault key", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  const key = Buffer.alloc(32, 11);
  harness.touchId.refresh(key);

  const unlockedKey = await harness.touchId.unlockKey();

  assert.deepEqual(harness.prompts, ["unlock KeyHarbor"]);
  assert.deepEqual(unlockedKey, key);
});

test("disabling Touch ID removes the saved credential", (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  harness.touchId.refresh(Buffer.alloc(32, 3));

  harness.touchId.disable();

  assert.equal(harness.touchId.hasCredential(), false);
  assert.equal(harness.touchId.getStatus(true).enabled, false);
});

test("a corrupt wrapped credential is rejected after authentication", async (t) => {
  const harness = createHarness();
  t.after(harness.cleanup);
  fs.writeFileSync(harness.credentialPath, "not-a-wrapped-key");

  await assert.rejects(
    harness.touchId.unlockKey(),
    (failure) => failure.code === "TOUCH_ID_CREDENTIAL_INVALID"
  );
  assert.deepEqual(harness.prompts, ["unlock KeyHarbor"]);
});
