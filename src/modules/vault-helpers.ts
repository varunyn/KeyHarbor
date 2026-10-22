import crypto from "node:crypto";

import type {
  SecretHistoryEntry,
  SecretRecord,
  VaultBoundaryRecord,
  VaultBoundaryValue,
  VaultData,
  VaultDictionary,
} from "./vault-types";

// Vault dictionaries use user-selected keys; strict deletion must still throw on frozen records.
export const deleteRecordKey = (
  record: VaultDictionary,
  key: string
): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete record[key];

export const isSafeInteger = (
  value: VaultBoundaryValue | number | null | undefined
): value is number => Number.isSafeInteger(value);

export const isString = (
  value: VaultBoundaryValue | SecretRecord
): value is string => typeof value === "string";

export const requireVaultKey = (key: Buffer | null): Buffer => {
  if (!Buffer.isBuffer(key)) {
    throw new TypeError("Vault is locked");
  }
  return key;
};

export const isObjectRecord = <T>(value: T): value is T & VaultBoundaryRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isSecretHistoryEntry = (
  entry: VaultBoundaryValue
): entry is SecretHistoryEntry =>
  isObjectRecord(entry) && isString(entry.value);

export const isFunction = (
  value: VaultBoundaryValue | ((...args: never[]) => void)
): value is (...args: never[]) => void => typeof value === "function";

export const readStringOrNull = (value: VaultBoundaryValue): string | null =>
  isString(value) ? value : null;

export const copyJsonData = <T>(value: T): T =>
  // eslint-disable-next-line unicorn/prefer-structured-clone
  JSON.parse(JSON.stringify(value));

export const sha256Hex = (buffer: crypto.BinaryLike): string =>
  crypto.createHash("sha256").update(buffer).digest("hex");

export const unsupportedVaultFormat = (message: string): Error => {
  const error = new Error(message);
  error.code = "VAULT_FORMAT_UNSUPPORTED";
  return error;
};

export function cloneVaultData(value: VaultData): VaultData;
export function cloneVaultData<T extends VaultBoundaryValue>(
  value: readonly T[]
): T[];
export function cloneVaultData<T extends VaultBoundaryValue>(value: T): T;
export function cloneVaultData(
  value: VaultBoundaryValue | VaultData
): VaultBoundaryValue | VaultData {
  if (Array.isArray(value)) {
    // SAFETY: Deep array cloning preserves element types.
    return value.map((entry) => cloneVaultData(entry)) as VaultBoundaryValue[];
  }
  if (!isObjectRecord(value)) {
    return value;
  }
  const copy: VaultBoundaryRecord = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype
  );
  for (const [key, entry] of Object.entries(value)) {
    // SAFETY: Cloned property values conform to VaultBoundaryValue.
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: cloneVaultData(entry as VaultBoundaryValue),
      writable: true,
    });
  }
  // SAFETY: Deep record cloning preserves object structure.
  return copy as VaultBoundaryRecord;
}

export const validateEnvironmentSecrets = (
  secrets: VaultBoundaryRecord
): void => {
  for (const [secretKey, secret] of Object.entries(secrets)) {
    if (!secretKey) {
      throw new Error("Invalid Vault secret key");
    }
    if (isString(secret)) {
      continue;
    }
    if (
      !secret ||
      !isObjectRecord(secret) ||
      Array.isArray(secret) ||
      !isString(secret.value)
    ) {
      throw new Error("Invalid Vault secret record");
    }
    const record = secret;
    if (
      record.expiresAt !== undefined &&
      record.expiresAt !== null &&
      !isString(record.expiresAt)
    ) {
      throw new Error("Invalid Vault secret expiration");
    }
    if (record.description !== undefined && !isString(record.description)) {
      throw new Error("Invalid Vault secret description");
    }
    if (
      record.tags !== undefined &&
      (!Array.isArray(record.tags) || record.tags.some((tag) => !isString(tag)))
    ) {
      throw new Error("Invalid Vault secret tags");
    }
    if (
      record.history !== undefined &&
      (!Array.isArray(record.history) ||
        record.history.some((rawEntry) => {
          if (
            !rawEntry ||
            !isObjectRecord(rawEntry) ||
            Array.isArray(rawEntry)
          ) {
            return true;
          }
          const entry = rawEntry;
          return (
            !isString(entry.value) ||
            (entry.expiresAt !== undefined &&
              entry.expiresAt !== null &&
              !isString(entry.expiresAt)) ||
            (entry.description !== undefined && !isString(entry.description)) ||
            (entry.tags !== undefined &&
              (!Array.isArray(entry.tags) ||
                entry.tags.some((tag) => !isString(tag))))
          );
        }))
    ) {
      throw new Error("Invalid Vault secret history");
    }
  }
};
