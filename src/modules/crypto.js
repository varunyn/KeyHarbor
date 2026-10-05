const crypto = require("node:crypto");

// Preserve the exported constructor and static method API used by consumers.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class, unicorn/no-static-only-class
class CryptoUtil {
  static deriveKey(password, salt, iterations = 4_000_000, keyLength = 32) {
    return crypto.pbkdf2Sync(password, salt, iterations, keyLength, "sha256");
  }

  static generateSalt(length = 32) {
    return crypto.randomBytes(length);
  }

  static encrypt(data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(data, "utf-8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
  }

  static decrypt(encryptedData, key) {
    const iv = encryptedData.slice(0, 16);
    const authTag = encryptedData.slice(16, 32);
    const ciphertext = encryptedData.slice(32);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf-8");
  }

  static encryptJson(jsonData, key) {
    const jsonString = JSON.stringify(jsonData);
    return this.encrypt(jsonString, key);
  }

  static decryptJson(encryptedData, key) {
    const jsonString = this.decrypt(encryptedData, key);
    return JSON.parse(jsonString);
  }

  static maskSensitiveValue(value, visibleChars = 3) {
    if (!value || value.length <= visibleChars) {
      return "***";
    }

    const visible = value.slice(0, Math.max(0, visibleChars));
    const masked = "*".repeat(value.length - visibleChars);
    return visible + masked;
  }

  static generateRandomString(length = 16) {
    return crypto
      .randomBytes(length)
      .toString("base64")
      .replaceAll(/[^a-zA-Z0-9]/gu, "")
      .slice(0, length);
  }
}

module.exports = CryptoUtil;
