import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Logger = require("../src/modules/logger");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keyharbor-usage-"));
const logger = new Logger(path.join(directory, "logs.enc"));
logger.setEncryptionKey(crypto.randomBytes(32));

after(() => {
  fs.rmSync(directory, { force: true, recursive: true });
});

test("dashboard usage counts only completed, structured records from this Vault instance", () => {
  const now = Date.now();
  const since = now - 24 * 60 * 60 * 1000;
  const currentVault = "vault-current";
  const otherFields = {
    action: "read",
    environmentId: "env-dev",
    environmentName: "dev",
    projectName: "api",
    vaultInstanceId: currentVault,
  };

  logger.logAccess("Secret read", "api", "TOKEN", {
    ...otherFields,
    outcome: "approved",
  });
  logger.logAccess("Secret denied", "api", "DENIED", {
    ...otherFields,
    outcome: "denied",
  });
  logger.logAccess("Secret pending", "api", "PENDING", otherFields);
  logger.logAccess("Secret read", "api", "OTHER", {
    ...otherFields,
    outcome: "approved",
    vaultInstanceId: "vault-other",
  });
  logger.logAccess("Legacy secret read", "api", "LEGACY");
  logger.logAccess("Secret read", "api", "", {
    ...otherFields,
    outcome: "approved",
  });

  assert.equal(logger.countCompletedAccess(since, currentVault), 1);
});
