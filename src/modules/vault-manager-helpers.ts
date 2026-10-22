import crypto from "node:crypto";
import fs from "node:fs";

import type { ManagerConfig } from "./vault-manager-types.js";
import type Vault = require("./vault");

const VAULTS_CONFIG_FILE = "vaults.enc";
const INVALID_NAME_CHARS = /[/\\*?"<>|]/u;
const SYSTEM_VAULT_ID = "system";
const SYSTEM_VAULT_NAME = "System";

// Copy through the persisted JSON format: retain its omission and coercion behavior.
const copyJsonData = <T>(value: T): T =>
  // eslint-disable-next-line unicorn/prefer-structured-clone
  JSON.parse(JSON.stringify(value));

// Preserve null construction/closed-session fields while the active facade retains its existing types.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const CLOSED_SYSTEM_VAULT: Vault = null!;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const CLOSED_CONFIG: ManagerConfig = null!;

const hashBytes = (bytes: Buffer | Uint8Array | string): string =>
  crypto.createHash("sha256").update(bytes).digest("hex");

const publishImmutableBackup = (targetPath: string, bytes: Buffer): boolean => {
  if (fs.existsSync(targetPath)) {
    return false;
  }
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
  try {
    fs.linkSync(temporaryPath, targetPath);
    return true;
  } finally {
    fs.unlinkSync(temporaryPath);
  }
};

const validateVaultName = (name: unknown): void => {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw new Error("Vault name cannot be empty");
  }
  if (INVALID_NAME_CHARS.test(name)) {
    throw new Error(
      'Vault name contains invalid characters (/, \\, *, ?, ", <, >, |)'
    );
  }
  if (name.trim().length > 100) {
    throw new Error("Vault name is too long (max 100 characters)");
  }
};

export {
  CLOSED_CONFIG,
  CLOSED_SYSTEM_VAULT,
  copyJsonData,
  hashBytes,
  INVALID_NAME_CHARS,
  publishImmutableBackup,
  SYSTEM_VAULT_ID,
  SYSTEM_VAULT_NAME,
  validateVaultName,
  VAULTS_CONFIG_FILE,
};
