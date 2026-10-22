import * as crypto from "node:crypto";

import type { StoredConfigurationBaseline } from "./vault-types";

const SHELL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_REQUIRED_KEYS = 5000;

const sortedValues = <T>(
  values: T[],
  compare?: (left: T, right: T) => number
): T[] => {
  const sorted = [...values];
  sorted.sort(compare);
  return sorted;
};

const invalidBaseline = (message: string): Error => {
  const error = new Error(message);
  error.code = "INVALID_VAULT_DATA";
  return error;
};

const isString = (value: unknown): value is string => typeof value === "string";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (!isString(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
};

const revisionHasControlCharacter = (revision: string): boolean =>
  [...revision].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });

const isBaselineRevision = (revision: unknown): revision is string =>
  isString(revision) &&
  revision.length > 0 &&
  revision.length <= 128 &&
  !revisionHasControlCharacter(revision);

const validateBaselineRevision = (revision: unknown): string => {
  if (!isBaselineRevision(revision)) {
    throw invalidBaseline("Invalid Project configuration baseline revision");
  }
  return revision;
};

const validateStoredBaseline = (
  value: unknown
): StoredConfigurationBaseline => {
  if (!isRecord(value)) {
    throw invalidBaseline("Invalid Project configuration baseline");
  }
  const fields = sortedValues(Object.keys(value));
  if (
    fields.length !== 3 ||
    fields[0] !== "requiredKeys" ||
    fields[1] !== "revision" ||
    fields[2] !== "updatedAt"
  ) {
    throw invalidBaseline("Invalid Project configuration baseline");
  }
  const keys = value.requiredKeys;
  if (
    !isUnknownArray(keys) ||
    keys.length === 0 ||
    keys.length > MAX_REQUIRED_KEYS
  ) {
    throw invalidBaseline("Invalid Project configuration baseline keys");
  }
  const validatedKeys: string[] = [];
  let previous: string | null = null;
  for (const key of keys) {
    if (
      !isString(key) ||
      !SHELL_IDENTIFIER.test(key) ||
      (previous !== null && previous >= key)
    ) {
      throw invalidBaseline("Invalid Project configuration baseline keys");
    }
    validatedKeys.push(key);
    previous = key;
  }
  const revision = validateBaselineRevision(value.revision);
  if (!isCanonicalTimestamp(value.updatedAt)) {
    throw invalidBaseline("Invalid Project configuration baseline timestamp");
  }
  return {
    requiredKeys: validatedKeys,
    revision,
    updatedAt: value.updatedAt,
  };
};

const normalizeRequiredKeys = (requiredKeys: unknown): string[] => {
  if (
    !isUnknownArray(requiredKeys) ||
    requiredKeys.length === 0 ||
    requiredKeys.length > MAX_REQUIRED_KEYS
  ) {
    throw new TypeError(
      "A baseline must contain at least one required key and no more than 5,000"
    );
  }
  const normalizedKeys: string[] = [];
  for (const key of requiredKeys) {
    if (!isString(key) || !SHELL_IDENTIFIER.test(key)) {
      throw new TypeError("Baseline contains an invalid required key");
    }
    normalizedKeys.push(key);
  }
  return sortedValues([...new Set(normalizedKeys)]);
};

const createBaseline = (
  requiredKeys: unknown,
  now = new Date()
): StoredConfigurationBaseline => ({
  requiredKeys: normalizeRequiredKeys(requiredKeys),
  revision: crypto.randomBytes(16).toString("hex"),
  updatedAt: now.toISOString(),
});

const ProjectConfigurationBaseline = {
  createBaseline,
  normalizeRequiredKeys,
  validateStoredBaseline,
};

export = ProjectConfigurationBaseline;
