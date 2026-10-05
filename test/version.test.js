const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, isNewerVersion } = require("../src/modules/version");

test("update comparison suppresses older and equal releases", () => {
  assert.equal(isNewerVersion("1.5.1", "1.6.0"), false);
  assert.equal(isNewerVersion("1.6.0", "1.6.0"), false);
  assert.equal(isNewerVersion("1.6.0-beta.2", "1.6.0"), false);
});

test("update comparison recognizes newer semantic versions", () => {
  assert.equal(isNewerVersion("1.7.0", "1.6.0"), true);
  assert.equal(isNewerVersion("2.0.0-beta.1", "1.7.0"), true);
  assert.equal(compareVersions("1.7.0", "1.6.9"), 1);
});

test("update comparison rejects malformed server versions", () => {
  assert.equal(compareVersions("latest", "1.7.0"), null);
  assert.equal(isNewerVersion("1.7", "1.7.0"), false);
  assert.equal(isNewerVersion("1.07.0", "1.7.0"), false);
});
