import fs from "node:fs";
import path from "node:path";

const KEY_HEX_PATTERN = /^[a-f0-9]{64}$/iu;

interface SystemPreferences {
  canPromptTouchID: () => boolean;
  promptTouchID: (reason: string) => Promise<void>;
}

interface SafeStorage {
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
  isEncryptionAvailable: () => boolean;
}

interface TouchIdUnlockOptions {
  platform: NodeJS.Platform | string;
  systemPreferences: SystemPreferences;
  safeStorage: SafeStorage;
  credentialPath: string;
}

interface TouchIdCredentialError extends Error {
  code?: string;
}

class TouchIdUnlock {
  platform: NodeJS.Platform | string;
  systemPreferences: SystemPreferences;
  safeStorage: SafeStorage;
  credentialPath: string;

  constructor({
    platform,
    systemPreferences,
    safeStorage,
    credentialPath,
  }: TouchIdUnlockOptions) {
    this.platform = platform;
    this.systemPreferences = systemPreferences;
    this.safeStorage = safeStorage;
    this.credentialPath = credentialPath;
  }

  isAvailable(): boolean {
    if (this.platform !== "darwin") {
      return false;
    }

    try {
      // Capability checks must not open Keychain or block the desktop at launch.
      return this.systemPreferences.canPromptTouchID();
    } catch {
      return false;
    }
  }

  hasCredential(): boolean {
    try {
      return fs.existsSync(this.credentialPath);
    } catch {
      return false;
    }
  }

  getStatus(configured: boolean) {
    const available = this.isAvailable();
    return {
      available,
      enabled: available && configured === true && this.hasCredential(),
    };
  }

  async enable(key: Buffer): Promise<void> {
    this._assertAvailable();
    await this.systemPreferences.promptTouchID(
      "enable Touch ID unlock for KeyHarbor"
    );
    this.refresh(key);
  }

  refresh(key: Buffer): void {
    this._assertAvailable();
    this._assertEncryptionAvailable();
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

  disable(): void {
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

  async unlockKey(): Promise<Buffer> {
    this._assertAvailable();
    if (!this.hasCredential()) {
      throw new Error("Touch ID unlock is not enabled");
    }

    await this.systemPreferences.promptTouchID("unlock KeyHarbor");
    this._assertEncryptionAvailable();

    try {
      const encrypted = fs.readFileSync(this.credentialPath);
      const keyHex = this.safeStorage.decryptString(encrypted);
      if (!KEY_HEX_PATTERN.test(keyHex)) {
        throw new Error("Invalid key data");
      }
      return Buffer.from(keyHex, "hex");
    } catch {
      const error: TouchIdCredentialError = new Error(
        "The saved Touch ID credential is invalid"
      );
      error.code = "TOUCH_ID_CREDENTIAL_INVALID";
      throw error;
    }
  }

  _assertEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Keychain encryption is not available on this Mac");
    }
  }

  _assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error("Touch ID is not available on this Mac");
    }
  }

  // Keep key validation on the existing instance API for callers and subclasses.
  // eslint-disable-next-line class-methods-use-this
  _validateKey(key: Buffer): Buffer {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error("Vault encryption key is unavailable");
    }
    return key;
  }
}

export = TouchIdUnlock;
