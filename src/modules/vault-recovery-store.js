const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const sortedValues = (values, compare) => {
  const sorted = [...values];
  sorted.sort(compare);
  return sorted;
};

const FORMAT_VERSION = 1;
const MAX_RECORD_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 64;
const ID_PATTERN = /^[a-f0-9]{32}$/u;
const INSTANCE_PATTERN = /^[a-f0-9]{64}$/u;

const canonicalHeader = (header) =>
  // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
  JSON.stringify({
    formatVersion: header.formatVersion,
    capsuleId: header.capsuleId,
    generation: header.generation,
    kind: header.kind,
    artifactId: header.artifactId,
    vaultInstanceId: header.vaultInstanceId,
    vaultId: header.vaultId,
    pathDigest: header.pathDigest,
    algorithm: header.algorithm,
    nonce: header.nonce,
  });

const recoveryError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const validateDepth = (value, depth = 0) => {
  if (depth > MAX_DEPTH) {
    throw recoveryError(
      "VAULT_RECOVERY_INVALID",
      "Recovery payload is too deeply nested"
    );
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const child of Object.values(value)) {
    validateDepth(child, depth + 1);
  }
};

const hasExactKeys = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = sortedValues(Object.keys(value));
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === sortedValues([...keys])[index])
  );
};

const isCanonicalBase64 = (value, bytes) => {
  if (typeof value !== "string") {
    return false;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value;
};

const validateRecoveryIdentity = (header) => {
  if (
    typeof header.artifactId !== "string" ||
    !header.artifactId ||
    (header.vaultId !== null && typeof header.vaultId !== "string") ||
    (header.pathDigest !== null &&
      !INSTANCE_PATTERN.test(header.pathDigest || ""))
  ) {
    throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery identity");
  }
};

class VaultRecoveryStore {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.maxRecordBytes = options.maxRecordBytes || MAX_RECORD_BYTES;
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { mode: 0o700, recursive: true });
    const stats = fs.lstatSync(this.directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw recoveryError(
        "VAULT_RECOVERY_UNSAFE_PATH",
        "Recovery directory is not a regular directory"
      );
    }
    try {
      fs.chmodSync(this.directory, 0o700);
    } catch {
      // Best-effort cleanup must not obscure the primary recovery operation.
    }
  }

  writeCapsule({
    key,
    kind = "vault",
    artifactId,
    vaultInstanceId,
    vaultId = null,
    vaultPath = null,
    generation,
    payload,
  }) {
    this._validateKey(key);
    this.ensureDirectory();
    if (kind !== "vault" && kind !== "manager_config") {
      throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery kind");
    }
    if (typeof artifactId !== "string" || !artifactId) {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Invalid artifact identity"
      );
    }
    if (!INSTANCE_PATTERN.test(vaultInstanceId || "")) {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Invalid Vault instance identity"
      );
    }
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Invalid recovery generation"
      );
    }
    validateDepth(payload);

    const capsuleId = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(12);
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    const header = {
      formatVersion: FORMAT_VERSION,
      capsuleId,
      generation,
      kind,
      artifactId,
      vaultInstanceId,
      vaultId,
      pathDigest: vaultPath
        ? crypto
            .createHash("sha256")
            .update(path.resolve(vaultPath))
            .digest("hex")
        : null,
      algorithm: "aes-256-gcm",
      nonce: nonce.toString("base64"),
    };
    const headerBytes = Buffer.from(canonicalHeader(header));
    const body = Buffer.from(JSON.stringify({ ...payload, identity: header }));
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(headerBytes);
    const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
    body.fill(0);
    const envelope = Buffer.from(
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      JSON.stringify({
        header,
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      })
    );
    if (envelope.length > this.maxRecordBytes) {
      throw recoveryError(
        "VAULT_RECOVERY_TOO_LARGE",
        "Recovery record is too large"
      );
    }

    const finalPath = this._capsulePath(capsuleId);
    const temporaryPath = `${finalPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporaryPath, "wx", 0o600);
      fs.writeFileSync(fd, envelope);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporaryPath, finalPath);
      this._fsyncDirectory();
      return Object.freeze({ ...header });
    } catch (error) {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup must not obscure the primary recovery operation.
      }
      throw error;
    } finally {
      envelope.fill(0);
      ciphertext.fill(0);
    }
  }

  listHeaders() {
    this.ensureDirectory();
    const headers = [];
    for (const name of fs.readdirSync(this.directory)) {
      if (!name.endsWith(".capsule")) {
        continue;
      }
      try {
        const envelope = this._readEnvelope(name.slice(0, -8));
        headers.push(Object.freeze({ ...envelope.header }));
      } catch {
        // Best-effort cleanup must not obscure the primary recovery operation.
      }
    }
    return sortedValues(
      headers,
      (left, right) => left.generation - right.generation
    );
  }

  // eslint-disable-next-line require-await -- Retain the async API boundary and its promise rejection contract.
  async enumerate() {
    return this.listHeaders();
  }

  readCapsule(capsuleId, key) {
    this._validateKey(key);
    const envelope = this._readEnvelope(capsuleId);
    const headerBytes = Buffer.from(canonicalHeader(envelope.header));
    const nonce = Buffer.from(envelope.header.nonce, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    let plaintext;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(headerBytes);
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      const payload = JSON.parse(plaintext.toString("utf-8"));
      validateDepth(payload);
      if (
        canonicalHeader(payload.identity || {}) !==
        canonicalHeader(envelope.header)
      ) {
        throw recoveryError(
          "VAULT_RECOVERY_IDENTITY_MISMATCH",
          "Recovery identity mismatch"
        );
      }
      delete payload.identity;
      return { header: Object.freeze({ ...envelope.header }), payload };
    } catch (error) {
      if (error.code?.startsWith("VAULT_RECOVERY_")) {
        throw error;
      }
      throw recoveryError(
        "VAULT_RECOVERY_AUTH_FAILED",
        "Recovery record could not be authenticated"
      );
    } finally {
      if (plaintext) {
        plaintext.fill(0);
      }
      ciphertext.fill(0);
    }
  }

  deleteCapsule(capsuleId) {
    const target = this._capsulePath(capsuleId);
    this._assertRegularFile(target);
    fs.unlinkSync(target);
    this._fsyncDirectory();
  }

  beginDestruction() {
    this.ensureDirectory();
    const target = path.join(this.directory, ".destroying");
    const fd = fs.openSync(target, "w", 0o600);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    this._fsyncDirectory();
  }

  hasDestructionTombstone() {
    return fs.existsSync(path.join(this.directory, ".destroying"));
  }

  finishDestruction() {
    for (const header of this.listHeaders()) {
      this.deleteCapsule(header.capsuleId);
    }
    try {
      fs.unlinkSync(path.join(this.directory, ".destroying"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    this._fsyncDirectory();
  }

  _readEnvelope(capsuleId) {
    const target = this._capsulePath(capsuleId);
    this._assertRegularFile(target);
    const stats = fs.statSync(target);
    if (stats.size > this.maxRecordBytes) {
      throw recoveryError(
        "VAULT_RECOVERY_TOO_LARGE",
        "Recovery record is too large"
      );
    }
    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(target, "utf-8"));
    } catch {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Recovery envelope is malformed"
      );
    }
    this._validateEnvelope(envelope, capsuleId);
    return envelope;
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  _validateEnvelope(envelope, capsuleId) {
    const header = envelope?.header;
    if (
      !hasExactKeys(envelope, ["header", "tag", "ciphertext"]) ||
      !hasExactKeys(header, [
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
      ]) ||
      header.formatVersion !== FORMAT_VERSION ||
      header.capsuleId !== capsuleId ||
      !ID_PATTERN.test(capsuleId)
    ) {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Invalid recovery envelope"
      );
    }
    if (
      !Number.isSafeInteger(header.generation) ||
      header.generation < 1 ||
      !INSTANCE_PATTERN.test(header.vaultInstanceId || "")
    ) {
      throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery header");
    }
    if (header.kind !== "vault" && header.kind !== "manager_config") {
      throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid recovery kind");
    }
    validateRecoveryIdentity(header);
    if (
      header.algorithm !== "aes-256-gcm" ||
      !isCanonicalBase64(header.nonce, 12)
    ) {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Invalid recovery algorithm"
      );
    }
    if (
      !isCanonicalBase64(envelope.tag, 16) ||
      typeof envelope.ciphertext !== "string" ||
      Buffer.from(envelope.ciphertext, "base64").toString("base64") !==
        envelope.ciphertext
    ) {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Invalid recovery ciphertext"
      );
    }
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  _validateKey(key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw recoveryError("VAULT_RECOVERY_INVALID_KEY", "Invalid recovery key");
    }
  }

  _capsulePath(capsuleId) {
    if (!ID_PATTERN.test(capsuleId || "")) {
      throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid capsule ID");
    }
    return path.join(this.directory, `${capsuleId}.capsule`);
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  _assertRegularFile(target) {
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
  }

  _fsyncDirectory() {
    try {
      const fd = fs.openSync(this.directory, "r");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {
      // Best-effort cleanup must not obscure the primary recovery operation.
    }
  }
}

module.exports = VaultRecoveryStore;
