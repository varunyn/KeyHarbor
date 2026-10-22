import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  CapsuleEnvelope,
  CapsuleHeader,
  CapsuleReadResult,
  RecoveryStoreOptions,
  WriteCapsuleRequest,
} from "./vault-recovery-store-types.js";
import {
  assertRegularFile,
  canonicalHeader,
  ID_PATTERN,
  isRecoveryError,
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
} from "./vault-recovery-store-validate.js";

class VaultRecoveryStore {
  directory: string;
  maxRecordBytes: number;

  constructor(directory: string, options: RecoveryStoreOptions = {}) {
    this.directory = path.resolve(directory);
    this.maxRecordBytes = options.maxRecordBytes || MAX_RECORD_BYTES;
  }

  ensureDirectory(): void {
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

  writeCapsule<TPayload extends object>(
    request: WriteCapsuleRequest<TPayload>
  ): CapsuleHeader {
    const {
      artifactId,
      generation,
      key,
      kind = "vault",
      payload,
      vaultId = null,
      vaultInstanceId,
      vaultPath = null,
    } = request;
    validateKey(key);
    this.ensureDirectory();
    const validatedKind = parseKind(kind);
    const validatedArtifactId = parseNonEmptyString(
      artifactId,
      "Invalid artifact identity"
    );
    const validatedInstanceId = parseInstanceId(
      vaultInstanceId,
      "Invalid Vault instance identity"
    );
    const validatedGeneration = parseSafeGeneration(
      generation,
      "Invalid recovery generation"
    );
    validateDepth(payload);

    const capsuleId = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(12);
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    const header: CapsuleHeader = {
      formatVersion: 1,
      capsuleId,
      generation: validatedGeneration,
      kind: validatedKind,
      artifactId: validatedArtifactId,
      vaultInstanceId: validatedInstanceId,
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
    let fd: number | undefined;
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

  listHeaders(): CapsuleHeader[] {
    this.ensureDirectory();
    const headers: CapsuleHeader[] = [];
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
  async enumerate(): Promise<CapsuleHeader[]> {
    return this.listHeaders();
  }

  readCapsule(capsuleId: string, key: Buffer): CapsuleReadResult {
    validateKey(key);
    const envelope = this._readEnvelope(capsuleId);
    const headerBytes = Buffer.from(canonicalHeader(envelope.header));
    const nonce = Buffer.from(envelope.header.nonce, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    let plaintext: Buffer | undefined;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(headerBytes);
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      const parsed: unknown = JSON.parse(plaintext.toString("utf-8"));
      validateDepth(parsed);
      const payload = parseDecryptedPayload(parsed, envelope.header);
      return { header: Object.freeze({ ...envelope.header }), payload };
    } catch (error) {
      if (isRecoveryError(error)) {
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

  deleteCapsule(capsuleId: string): void {
    const target = this._capsulePath(capsuleId);
    assertRegularFile(target);
    fs.unlinkSync(target);
    this._fsyncDirectory();
  }

  beginDestruction(): void {
    this.ensureDirectory();
    const target = path.join(this.directory, ".destroying");
    const fd = fs.openSync(target, "w", 0o600);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    this._fsyncDirectory();
  }

  hasDestructionTombstone(): boolean {
    return fs.existsSync(path.join(this.directory, ".destroying"));
  }

  finishDestruction(): void {
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

  _readEnvelope(capsuleId: string): CapsuleEnvelope {
    const target = this._capsulePath(capsuleId);
    assertRegularFile(target);
    const stats = fs.statSync(target);
    if (stats.size > this.maxRecordBytes) {
      throw recoveryError(
        "VAULT_RECOVERY_TOO_LARGE",
        "Recovery record is too large"
      );
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(fs.readFileSync(target, "utf-8"));
    } catch {
      throw recoveryError(
        "VAULT_RECOVERY_INVALID",
        "Recovery envelope is malformed"
      );
    }
    return parseEnvelope(envelope, capsuleId);
  }

  _capsulePath(capsuleId: string): string {
    if (!ID_PATTERN.test(capsuleId || "")) {
      throw recoveryError("VAULT_RECOVERY_INVALID", "Invalid capsule ID");
    }
    return path.join(this.directory, `${capsuleId}.capsule`);
  }

  _fsyncDirectory(): void {
    try {
      const fd = fs.openSync(this.directory, "r");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {
      // Best-effort cleanup must not obscure the primary recovery operation.
    }
  }
}

export = VaultRecoveryStore;
