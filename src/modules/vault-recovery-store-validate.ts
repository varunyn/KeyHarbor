import fs from "node:fs";

import type {
  CapsuleEnvelope,
  CapsuleHeader,
  CapsuleIdentityFields,
  RecoveryError,
  RecoveryErrorCode,
  RecoveryKind,
  RecoveryPayload,
} from "./vault-recovery-store-types.js";

const FORMAT_VERSION = 1;
const MAX_RECORD_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 64;
const ID_PATTERN = /^[a-f0-9]{32}$/u;
const INSTANCE_PATTERN = /^[a-f0-9]{64}$/u;

const ENVELOPE_KEYS = ["header", "tag", "ciphertext"] as const;
// eslint-disable-next-line sort-keys -- Match the established serialized header field order.
const HEADER_KEYS = [
  "formatVersion",
  "capsuleId",
  "generation",
  "kind",
  "artifactId",
  "vaultInstanceId",
  "vaultId",
  "pathDigest",
  "algorithm",
  "nonce",
] as const;

type HeaderKey = (typeof HEADER_KEYS)[number];
type HeaderSource = Record<HeaderKey, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isObjectLike = (
  value: unknown
): value is Record<string, unknown> | unknown[] =>
  typeof value === "object" && value !== null;

const isSafePositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const isCanonicalBase64String = (value: unknown): value is string =>
  typeof value === "string" &&
  Buffer.from(value, "base64").toString("base64") === value;

const isCanonicalBase64 = (value: unknown, bytes: number): value is string =>
  isCanonicalBase64String(value) &&
  Buffer.from(value, "base64").length === bytes;

const isRecoveryError = (error: unknown): error is RecoveryError =>
  error instanceof Error &&
  typeof error.code === "string" &&
  error.code.startsWith("VAULT_RECOVERY_");

const recoveryError = (
  code: RecoveryErrorCode,
  message: string
): RecoveryError => Object.assign(new Error(message), { code });

const sortedValues = <T>(
  values: Iterable<T>,
  compare?: (left: T, right: T) => number
): T[] => {
  const sorted = [...values];
  sorted.sort(compare);
  return sorted;
};

const canonicalHeader = (header: unknown): string => {
  const source: Record<string, unknown> = isRecord(header) ? header : {};
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  return JSON.stringify({
    formatVersion: source.formatVersion,
    capsuleId: source.capsuleId,
    generation: source.generation,
    kind: source.kind,
    artifactId: source.artifactId,
    vaultInstanceId: source.vaultInstanceId,
    vaultId: source.vaultId,
    pathDigest: source.pathDigest,
    algorithm: source.algorithm,
    nonce: source.nonce,
  });
};

const validateDepth = (value: unknown, depth = 0): void => {
  if (depth > MAX_DEPTH) {
    throw recoveryError(
      "VAULT_RECOVERY_INVALID",
      "Recovery payload is too deeply nested"
    );
  }
  if (!isObjectLike(value)) {
    return;
  }
  for (const child of Object.values(value)) {
    validateDepth(child, depth + 1);
  }
};

const hasExactKeys = <K extends string>(
  value: unknown,
  keys: readonly K[]
): value is Record<K, unknown> => {
  if (!isRecord(value)) {
    return false;
  }
  const actual = sortedValues(Object.keys(value));
  const expected = sortedValues([...keys]);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const validateKey = (key: unknown): void => {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw recoveryError("VAULT_RECOVERY_INVALID_KEY", "Invalid recovery key");
  }
};

const assertRegularFile = (target: string): void => {
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw recoveryError(
        "VAULT_RECOVERY_NOT_FOUND",
        "Recovery record not found"
      );
    }
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw recoveryError(
      "VAULT_RECOVERY_UNSAFE_PATH",
      "Recovery record is not a regular file"
    );
  }
};

const parseKind = (value: unknown): RecoveryKind => {
  if (value !== "vault" && value !== "manager_config") {
    throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery kind");
  }
  return value;
};

const parseNonEmptyString = (value: unknown, message: string): string => {
  if (typeof value !== "string" || !value) {
    throw recoveryError("VAULT_RECOVERY_INVALID", message);
  }
  return value;
};

const parseInstanceId = (value: unknown, message: string): string => {
  if (typeof value !== "string" || !INSTANCE_PATTERN.test(value)) {
    throw recoveryError("VAULT_RECOVERY_INVALID", message);
  }
  return value;
};

const parseSafeGeneration = (value: unknown, message: string): number => {
  if (!isSafePositiveInteger(value)) {
    throw recoveryError("VAULT_RECOVERY_INVALID", message);
  }
  return value;
};

const parseIdentityFields = (header: HeaderSource): CapsuleIdentityFields => {
  const { artifactId, pathDigest, vaultId } = header;
  if (
    typeof artifactId !== "string" ||
    !artifactId ||
    (vaultId !== null && typeof vaultId !== "string") ||
    (pathDigest !== null &&
      (typeof pathDigest !== "string" || !INSTANCE_PATTERN.test(pathDigest)))
  ) {
    throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery identity");
  }
  return { artifactId, pathDigest, vaultId };
};

const parseAlgorithm = (value: unknown): "aes-256-gcm" => {
  if (value !== "aes-256-gcm") {
    throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery algorithm");
  }
  return value;
};

const parseEnvelope = (value: unknown, capsuleId: string): CapsuleEnvelope => {
  const headerSource = isRecord(value) ? value.header : undefined;
  if (
    !hasExactKeys(value, ENVELOPE_KEYS) ||
    !hasExactKeys(headerSource, HEADER_KEYS) ||
    headerSource.formatVersion !== FORMAT_VERSION ||
    headerSource.capsuleId !== capsuleId ||
    !ID_PATTERN.test(capsuleId || "")
  ) {
    throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery envelope");
  }
  const generation = parseSafeGeneration(
    headerSource.generation,
    "Invalid recovery header"
  );
  const vaultInstanceId = parseInstanceId(
    headerSource.vaultInstanceId,
    "Invalid recovery header"
  );
  const kind = parseKind(headerSource.kind);
  const { artifactId, pathDigest, vaultId } = parseIdentityFields(headerSource);
  const algorithm = parseAlgorithm(headerSource.algorithm);
  const { nonce } = headerSource;
  if (!isCanonicalBase64(nonce, 12)) {
    throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery algorithm");
  }
  const { ciphertext, tag } = value;
  if (!isCanonicalBase64(tag, 16) || !isCanonicalBase64String(ciphertext)) {
    throw recoveryError(
      "VAULT_RECOVERY_INVALID",
      "Invalid recovery ciphertext"
    );
  }
  return {
    ciphertext,
    header: {
      algorithm,
      artifactId,
      capsuleId,
      formatVersion: FORMAT_VERSION,
      generation,
      kind,
      nonce,
      pathDigest,
      vaultId,
      vaultInstanceId,
    },
    tag,
  };
};

const parseDecryptedPayload = (
  value: unknown,
  header: CapsuleHeader
): RecoveryPayload => {
  // The original dereference of a nullish plaintext raised a TypeError that the
  // caller reported as an authentication failure; keep that outcome explicit.
  if (value === null || value === undefined) {
    throw recoveryError(
      "VAULT_RECOVERY_AUTH_FAILED",
      "Recovery record could not be authenticated"
    );
  }
  const identity = isRecord(value) ? value.identity : undefined;
  if (canonicalHeader(identity) !== canonicalHeader(header)) {
    throw recoveryError(
      "VAULT_RECOVERY_IDENTITY_MISMATCH",
      "Recovery identity mismatch"
    );
  }
  if (!isRecord(value)) {
    throw recoveryError(
      "VAULT_RECOVERY_IDENTITY_MISMATCH",
      "Recovery identity mismatch"
    );
  }
  const payload: RecoveryPayload = {};
  for (const [name, entry] of Object.entries(value)) {
    if (name !== "identity") {
      payload[name] = entry;
    }
  }
  return payload;
};

export {
  assertRegularFile,
  canonicalHeader,
  FORMAT_VERSION,
  ID_PATTERN,
  INSTANCE_PATTERN,
  isRecoveryError,
  MAX_DEPTH,
  MAX_RECORD_BYTES,
  parseDecryptedPayload,
  parseEnvelope,
  parseInstanceId,
  parseKind,
  parseNonEmptyString,
  parseSafeGeneration,
  recoveryError,
  sortedValues,
  validateDepth,
  validateKey,
};
