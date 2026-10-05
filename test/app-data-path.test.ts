import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getAppDataPath } from "../src/modules/app-data-path.js";

test("new installations use KeyHarbor data; existing vaults stay in place", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "keyharbor-data-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const current = path.join(home, ".keyharbor");
  const legacy = path.join(home, ".localkeys");
  assert.equal(getAppDataPath(home), current);
  assert.equal(fs.existsSync(current), false);
  fs.mkdirSync(legacy);
  const vault = path.join(legacy, "vault-v2.enc");
  fs.writeFileSync(vault, "synthetic-encrypted-vault");
  assert.equal(getAppDataPath(home), legacy);
  // Even if both directories exist, don't silently switch an existing installation.
  fs.mkdirSync(current);
  assert.equal(getAppDataPath(home), legacy);
  assert.equal(fs.readFileSync(vault, "utf-8"), "synthetic-encrypted-vault");
});
