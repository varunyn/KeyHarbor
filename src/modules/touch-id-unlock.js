const fs = require("node:fs");
const path = require("node:path");

const KEY_HEX_PATTERN = /^[a-f0-9]{64}$/iu;

class TouchIdUnlock {
  constructor({ platform, systemPreferences, safeStorage, credentialPath }) {
    this.platform = platform;
    this.systemPreferences = systemPreferences;
    this.safeStorage = safeStorage;
    this.credentialPath = credentialPath;
  }

  isAvailable() {
    if (this.platform !== "darwin") {
      return false;
    }

    try {
      return (
        this.safeStorage.isEncryptionAvailable() &&
        this.systemPreferences.canPromptTouchID()
      );
    } catch {
      return false;
    }
  }

  hasCredential() {
    try {
      return fs.existsSync(this.credentialPath);
    } catch {
      return false;
    }
  }

  getStatus(configured) {
    const available = this.isAvailable();
    return {
      available,
      enabled: available && configured === true && this.hasCredential(),
    };
  }

  async enable(key) {
    this._assertAvailable();
    await this.systemPreferences.promptTouchID(
      "enable Touch ID unlock for KeyHarbor"
    );
    this.refresh(key);
  }

  refresh(key) {
    this._assertAvailable();
    const keyHex = this._validateKey(key).toString("hex");
    const encrypted = this.safeStorage.encryptString(keyHex);
    const directory = path.dirname(this.credentialPath);
    const temporaryPath = `${this.credentialPath}.tmp`;

    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      fs.renameSync(temporaryPath, this.credentialPath);
      try {
        fs.chmodSync(this.credentialPath, 0o600);
      } catch {
        // Best-effort permissions and cleanup must not replace the original result.
      }
    } catch (error) {
      try {
        if (fs.existsSync(temporaryPath)) {
          fs.unlinkSync(temporaryPath);
        }
      } catch {
        // Temporary-file cleanup is best effort; preserve the original write failure.
      }
      throw error;
    }
  }

  disable() {
    try {
      if (fs.existsSync(this.credentialPath)) {
        fs.unlinkSync(this.credentialPath);
      }
    } catch (error) {
      throw new Error(
        `Failed to remove the Touch ID credential: ${error.message}`,
        { cause: error }
      );
    }
  }

  async unlockKey() {
    this._assertAvailable();
    if (!this.hasCredential()) {
      throw new Error("Touch ID unlock is not enabled");
    }

    await this.systemPreferences.promptTouchID("unlock KeyHarbor");

    try {
      const encrypted = fs.readFileSync(this.credentialPath);
      const keyHex = this.safeStorage.decryptString(encrypted);
      if (!KEY_HEX_PATTERN.test(keyHex)) {
        throw new Error("Invalid key data");
      }
      return Buffer.from(keyHex, "hex");
    } catch {
      const error = new Error("The saved Touch ID credential is invalid");
      error.code = "TOUCH_ID_CREDENTIAL_INVALID";
      throw error;
    }
  }

  _assertAvailable() {
    if (!this.isAvailable()) {
      throw new Error("Touch ID is not available on this Mac");
    }
  }

  // Keep key validation on the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _validateKey(key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error("Vault encryption key is unavailable");
    }
    return key;
  }
}

module.exports = TouchIdUnlock;
