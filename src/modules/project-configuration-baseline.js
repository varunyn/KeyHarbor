const crypto = require("node:crypto");

const sortedValues = (values, compare) => {
  const sorted = [...values];
  sorted.sort(compare);
  return sorted;
};

const SHELL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_REQUIRED_KEYS = 5000;

const invalidBaseline = (message) => {
  const error = new Error(message);
  error.code = "INVALID_VAULT_DATA";
  return error;
};

const isCanonicalTimestamp = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
};

const revisionHasControlCharacter = (revision) =>
  typeof revision === "string" &&
  [...revision].some(
    (character) =>
      character.codePointAt(0) < 32 || character.codePointAt(0) === 127
  );

const validateBaselineRevision = (revision) => {
  if (
    typeof revision !== "string" ||
    revision.length === 0 ||
    revision.length > 128 ||
    revisionHasControlCharacter(revision)
  ) {
    throw invalidBaseline("Invalid Project configuration baseline revision");
  }
};

const validateStoredBaseline = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.length > MAX_REQUIRED_KEYS
  ) {
    throw invalidBaseline("Invalid Project configuration baseline keys");
  }
  let previous = null;
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      !SHELL_IDENTIFIER.test(key) ||
      (previous !== null && previous >= key)
    ) {
      throw invalidBaseline("Invalid Project configuration baseline keys");
    }
    previous = key;
  }
  validateBaselineRevision(value.revision);
  if (!isCanonicalTimestamp(value.updatedAt)) {
    throw invalidBaseline("Invalid Project configuration baseline timestamp");
  }
  return {
    requiredKeys: [...keys],
    revision: value.revision,
    updatedAt: value.updatedAt,
  };
};

const normalizeRequiredKeys = (requiredKeys) => {
  if (
    !Array.isArray(requiredKeys) ||
    requiredKeys.length === 0 ||
    requiredKeys.length > MAX_REQUIRED_KEYS
  ) {
    throw new TypeError(
      "A baseline must contain at least one required key and no more than 5,000"
    );
  }
  for (const key of requiredKeys) {
    if (typeof key !== "string" || !SHELL_IDENTIFIER.test(key)) {
      throw new TypeError("Baseline contains an invalid required key");
    }
  }
  return sortedValues([...new Set(requiredKeys)]);
};

const createBaseline = (requiredKeys, now = new Date()) => ({
  requiredKeys: normalizeRequiredKeys(requiredKeys),
  revision: crypto.randomBytes(16).toString("hex"),
  updatedAt: now.toISOString(),
});

module.exports = {
  createBaseline,
  normalizeRequiredKeys,
  validateStoredBaseline,
};
