const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");
const {
  checkForUpdate,
  normalizeReleaseTag,
  selectNewerVersion,
  startUpdatePolling,
} = require("../src/modules/update-checker");

test("release tags normalize before comparison", () => {
  assert.equal(normalizeReleaseTag("  v1.7.0 "), "1.7.0");
  assert.equal(normalizeReleaseTag("1.7.0"), "1.7.0");
});

test("newer releases resolve to their normalized version", () => {
  assert.equal(selectNewerVersion("v1.7.0", "1.6.0"), "1.7.0");
  assert.equal(selectNewerVersion("2.0.0-beta.1", "1.7.0"), "2.0.0-beta.1");
});

test("older, equal, and malformed releases resolve to null", () => {
  assert.equal(selectNewerVersion("1.5.1", "1.6.0"), null);
  assert.equal(selectNewerVersion("1.6.0", "1.6.0"), null);
  assert.equal(selectNewerVersion("latest", "1.7.0"), null);
  assert.equal(selectNewerVersion("   ", "1.7.0"), null);
});

test("manual check reports newer, current, and failed outcomes", async () => {
  const newer = await checkForUpdate("1.6.0", () => Promise.resolve("v1.7.0"));
  assert.deepEqual(newer, { status: "newer", version: "1.7.0" });

  const current = await checkForUpdate("1.6.0", () =>
    Promise.resolve("v1.6.0")
  );
  assert.deepEqual(current, { status: "current", version: null });

  const failed = await checkForUpdate("1.6.0", () => Promise.resolve(null));
  assert.deepEqual(failed, { status: "failed", version: null });

  const threw = await checkForUpdate("1.6.0", () =>
    Promise.reject(new Error("offline"))
  );
  assert.deepEqual(threw, { status: "failed", version: null });
});

test("polling notifies on startup and repeats on its interval", async () => {
  const seen = [];
  const stop = startUpdatePolling({
    check: () => Promise.resolve("9.9.9"),
    initialDelayMs: 5,
    intervalMs: 15,
    isEnabled: () => true,
    onUpdate: (version) => {
      seen.push(version);
    },
  });
  await sleep(50);
  stop();
  assert.ok(seen.length >= 1);
  assert.equal(seen[0], "9.9.9");
  const count = seen.length;
  await sleep(40);
  assert.equal(seen.length, count);
});

test("polling stays silent while updates are disabled", async () => {
  const seen = [];
  const stop = startUpdatePolling({
    check: () => Promise.resolve("9.9.9"),
    initialDelayMs: 5,
    intervalMs: 10,
    isEnabled: () => false,
    onUpdate: (version) => {
      seen.push(version);
    },
  });
  await sleep(40);
  stop();
  assert.deepEqual(seen, []);
});
