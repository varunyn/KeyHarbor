const fs = require("node:fs");
const CryptoUtil = require("./crypto");

type LogCategory = "access" | "app" | "lock" | "info" | string;

/** Structured access metadata. Legacy entries without a target stay unscoped. */
interface AccessTarget {
  vaultId?: string | null;
  vaultInstanceId?: string | null;
  projectName: string;
  environmentId: string;
  environmentName: string;
  key?: string;
  action: string;
  /** "approved" marks completed access; denials and stale reviews are recorded as "denied". */
  outcome?: "approved" | "denied";
}

interface LogEntry {
  timestamp: string;
  category: LogCategory;
  message: string;
  target?: AccessTarget;
}

interface LogStats {
  total: number;
  byCategory: Record<string, number>;
  recentActivity: LogEntry[];
}

// The CommonJS constructor merges with exported type aliases below.
// eslint-disable-next-line no-redeclare
class Logger {
  logPath: string;
  maxLogEntries: number;
  encryptionKey: Buffer | null;

  constructor(logPath: string) {
    this.logPath = logPath;
    this.maxLogEntries = 1000;
    this.encryptionKey = null;
  }

  setEncryptionKey(key: Buffer) {
    this.encryptionKey = key;
  }

  clearEncryptionKey() {
    this.encryptionKey = null;
  }

  log(message: string, category: LogCategory = "app", metadata?: AccessTarget) {
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      category,
      message: this._maskSensitiveInfo(message),
      timestamp,
      ...(metadata ? { target: metadata } : {}),
    };

    let logs = this._readLogs();
    logs.push(logEntry);

    if (logs.length > this.maxLogEntries) {
      logs = logs.slice(-this.maxLogEntries);
    }

    this._writeLogs(logs);
  }

  /**
   * Records one structured access event per requested key so downstream usage
   * views can match exact fields instead of message substrings. Callers pass
   * the key array; a bare string is only accepted for unscoped legacy callers.
   */
  logAccess(
    action: string,
    project: string,
    key: string | string[],
    target?: Partial<AccessTarget>
  ) {
    const keys = (Array.isArray(key) ? key : [key]).filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0
    );
    if (
      !target ||
      typeof target.environmentId !== "string" ||
      typeof target.environmentName !== "string"
    ) {
      this.log(
        `${action} - Project: ${project}, Key: ${keys.join(", ")}`,
        "access"
      );
      return;
    }
    for (const secretKey of keys) {
      const message = `${action} - Project: ${project}, Environment: ${target.environmentName}, Key: ${secretKey}`;
      this.log(message, "access", {
        action: target.action || action,
        environmentId: target.environmentId,
        environmentName: target.environmentName,
        key: secretKey,
        projectName: project,
        vaultId: target.vaultId ?? null,
        vaultInstanceId: target.vaultInstanceId ?? null,
        ...(target.outcome ? { outcome: target.outcome } : {}),
      });
    }
  }

  logApp(event: string) {
    this.log(event, "app");
  }

  logLock(event: string) {
    this.log(event, "lock");
  }

  getLogs(): LogEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    try {
      return this._readLogs();
    } catch (error) {
      console.error("Failed to read log file:", error.message);
      return [];
    }
  }

  getFilteredLogs(
    category: LogCategory | null = null,
    limit = 100
  ): LogEntry[] {
    let logs = this.getLogs();

    if (category) {
      logs = logs.filter((log) => log.category === category);
    }

    // Node 20.19 is supported; reverse mutates only the freshly loaded local array.
    // eslint-disable-next-line unicorn/no-array-reverse
    return logs.reverse().slice(0, limit);
  }

  getLogStats(): LogStats {
    const logs = this.getLogs();
    const stats: LogStats = {
      byCategory: {},
      recentActivity: [],
      total: logs.length,
    };

    for (const log of logs) {
      stats.byCategory[log.category] =
        (stats.byCategory[log.category] || 0) + 1;
    }

    // Reverse only the new slice; retain compatibility with the ES2022 compilation target.
    // eslint-disable-next-line unicorn/no-array-reverse
    stats.recentActivity = logs.slice(-10).reverse();

    return stats;
  }

  /**
   * Completed access only. Denied approvals, closed dialogs and stale reviews
   * are recorded as access events but never as delivered credentials.
   */
  countCompletedAccess(sinceMs: number, vaultInstanceId: string): number {
    return this.getLogs().filter((log) => {
      const { target } = log;
      if (log.category !== "access") {
        return false;
      }
      if (new Date(log.timestamp).getTime() < sinceMs) {
        return false;
      }
      return (
        target?.vaultInstanceId === vaultInstanceId &&
        typeof target.projectName === "string" &&
        typeof target.environmentId === "string" &&
        typeof target.key === "string" &&
        target.key.length > 0 &&
        typeof target.action === "string" &&
        target.action.length > 0 &&
        target.outcome === "approved"
      );
    }).length;
  }

  clearLogs() {
    if (fs.existsSync(this.logPath)) {
      fs.unlinkSync(this.logPath);
      this.log("Log file cleared", "info");
    }
  }

  _readLogs(): LogEntry[] {
    if (!this.encryptionKey) {
      return [];
    }

    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    try {
      const fileData = fs.readFileSync(this.logPath);

      try {
        const decryptedData = CryptoUtil.decryptJson(
          fileData,
          this.encryptionKey
        );
        return Array.isArray(decryptedData)
          ? (decryptedData as LogEntry[])
          : [];
      } catch (error) {
        console.error("Failed to decrypt logs:", error.message);
        return [];
      }
    } catch (error) {
      console.error("Failed to read logs:", error.message);
      return [];
    }
  }

  _writeLogs(logs: LogEntry[]) {
    if (!this.encryptionKey) {
      console.warn("Encryption key not set - logs will not be saved");
      return;
    }

    try {
      const dataToWrite = CryptoUtil.encryptJson(logs, this.encryptionKey);
      fs.writeFileSync(this.logPath, dataToWrite);
      try {
        fs.chmodSync(this.logPath, 0o600);
      } catch {
        // File content remains usable if best-effort permission repair fails.
      }
    } catch (error) {
      console.error("Failed to write logs:", error.message);
    }
  }

  // Retain the existing overridable instance masking API.
  // eslint-disable-next-line class-methods-use-this
  _maskSensitiveInfo(message: string) {
    let maskedMessage = message;
    maskedMessage = maskedMessage.replaceAll(
      /\bsk-[a-zA-Z0-9]{20,}\b/gu,
      (match) => CryptoUtil.maskSensitiveValue(match, 6)
    );

    maskedMessage = maskedMessage.replaceAll(
      /\b[a-zA-Z0-9]{32,}\b/gu,
      (match) => CryptoUtil.maskSensitiveValue(match, 4)
    );

    maskedMessage = maskedMessage.replaceAll(
      // Preserve ASCII case-folding in the established secret-masking pattern.
      // eslint-disable-next-line require-unicode-regexp
      /password[:\s=]+(?<password>[^\s]+)/gi,
      (match, password) => match.replace(password, "***")
    );

    maskedMessage = maskedMessage.replaceAll(
      // Preserve ASCII case-folding in the established secret-masking pattern.
      // eslint-disable-next-line require-unicode-regexp
      /\b(?<prefix>token[:\s=]+)[^\s]+/gi,
      (match, prefix) => `${prefix}***`
    );

    return maskedMessage;
  }

  archiveLogs(daysToKeep = 30) {
    if (!this.encryptionKey) {
      console.warn("Encryption key not set - logs cannot be archived");
      return;
    }

    const logs = this.getLogs();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const recentLogs = logs.filter(
      (log) => new Date(log.timestamp) > cutoffDate
    );

    const oldLogs = logs.filter((log) => new Date(log.timestamp) <= cutoffDate);

    if (oldLogs.length > 0) {
      const basePath = this.logPath.endsWith(".enc")
        ? this.logPath.slice(0, -4)
        : this.logPath;
      const archivePath = `${basePath}_archive_${Date.now()}.enc`;

      const encryptedArchive = CryptoUtil.encryptJson(
        oldLogs,
        this.encryptionKey
      );
      fs.writeFileSync(archivePath, encryptedArchive);
      try {
        fs.chmodSync(archivePath, 0o600);
      } catch {
        // Archive permission repair is best effort after content is written.
      }
    }

    this._writeLogs(recentLogs);

    this.log(`Archived ${oldLogs.length} old log entries`, "info");
  }
}

// Preserve Logger.Category/Target/Entry/Stats without changing its CommonJS runtime export.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Logger {
  export type Category = LogCategory;
  export type Target = AccessTarget;
  export type Entry = LogEntry;
  export type Stats = LogStats;
}

export = Logger;
