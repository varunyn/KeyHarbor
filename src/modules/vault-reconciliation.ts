import crypto = require("node:crypto");
import fs = require("node:fs");
import CryptoUtil = require("./crypto");
import {
  clone,
  createBaseline,
  equal,
  validateAndCloneVaultData,
} from "./vault-reconciliation-data";
import { mergeVaultData } from "./vault-reconciliation-merge";
import type {
  VaultConflictDetail,
  VaultReconciliationHost,
  VaultReconciliationPlanPayload,
} from "./vault-types";

const DISK_MISSING = "missing";
const DISK_UNREADABLE = "unreadable";
interface PendingPlan {
  id: string;
  sessionRevision: number;
  diskFingerprint: string;
  sessionData: ReturnType<VaultReconciliationHost["_getNormalizedCopyOfData"]>;
  diskData: ReturnType<
    VaultReconciliationHost["_getNormalizedCopyOfData"]
  > | null;
  diskBytes: Buffer | null;
  reason: string;
  conflicts: VaultConflictDetail[];
  allowedDecisions: readonly ("use_disk" | "keep_session")[];
}

const fingerprint = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

const diskMarker = (vaultPath) => {
  try {
    return fingerprint(fs.readFileSync(vaultPath));
  } catch (error) {
    return error?.code === "ENOENT" ? DISK_MISSING : DISK_UNREADABLE;
  }
};

class VaultReconciliation {
  vault: VaultReconciliationHost;
  pendingPlan: PendingPlan | null = null;

  constructor(vault: VaultReconciliationHost) {
    this.vault = vault;
    this.pendingPlan = null;
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  createBaseline(data) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return createBaseline(data || { projects: {}, favorites: {} });
  }

  clearPlan() {
    this.pendingPlan = null;
  }

  _readDisk() {
    let bytes;
    try {
      bytes = fs.readFileSync(this.vault.vaultPath);
    } catch (error) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return {
        ok: false,
        reason: error?.code === "ENOENT" ? "disk_missing" : "disk_unreadable",
        diskFingerprint:
          error?.code === "ENOENT" ? DISK_MISSING : DISK_UNREADABLE,
      };
    }

    const diskFingerprint = fingerprint(bytes);
    try {
      const decrypted = CryptoUtil.decryptJson(bytes, this.vault.key);
      const validated = validateAndCloneVaultData(decrypted);
      const data = this.vault._getNormalizedCopyOfData(validated);
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return { ok: true, bytes, diskFingerprint, data };
    } catch (error) {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      return {
        ok: false,
        reason:
          error?.code === "INVALID_VAULT_DATA"
            ? "invalid_vault"
            : "disk_unreadable",
        diskFingerprint,
      };
    }
  }

  _createPlan(reason, diskResult, conflicts: VaultConflictDetail[] = []) {
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    const plan = {
      id: crypto.randomBytes(16).toString("hex"),
      sessionRevision: this.vault.sessionRevision,
      diskFingerprint: diskResult.diskFingerprint,
      sessionData: clone(this.vault.data),
      diskData: diskResult.ok ? clone(diskResult.data) : null,
      diskBytes: diskResult.ok ? Buffer.from(diskResult.bytes) : null,
      reason,
      conflicts: clone(conflicts),
      allowedDecisions: diskResult.ok
        ? (["use_disk", "keep_session"] as const)
        : (["keep_session"] as const),
    };
    this.pendingPlan = plan;
    const outcome = this._outcomeForPlan(plan);
    this.vault._notifyConflict(outcome);
    return outcome;
  }

  // eslint-disable-next-line class-methods-use-this -- Retain the established instance-method API used by callers.
  _outcomeForPlan(plan): VaultReconciliationPlanPayload {
    const outcome: VaultReconciliationPlanPayload = {
      allowedDecisions: [...plan.allowedDecisions],
      reason: plan.reason,
      reconciliationId: plan.id,
      status: "needs_resolution",
    };
    if (plan.conflicts.length > 0) {
      outcome.conflicts = clone(plan.conflicts);
    }
    return outcome;
  }

  async reconcileExternalChange(_options = {}) {
    this.vault._ensureUnlocked();
    const diskResult = this._readDisk();
    if (
      this.pendingPlan &&
      this.pendingPlan.sessionRevision === this.vault.sessionRevision &&
      this.pendingPlan.diskFingerprint === diskResult.diskFingerprint
    ) {
      return this._outcomeForPlan(this.pendingPlan);
    }
    if (!diskResult.ok) {
      return this._createPlan(diskResult.reason, diskResult);
    }
    if (diskResult.diskFingerprint === this.vault._diskContentHash) {
      this.clearPlan();
      return { status: "unchanged" };
    }

    const result = mergeVaultData(
      this.vault.data,
      diskResult.data,
      this.vault._syncBaseline || this.createBaseline(this.vault.data),
      this.vault.maxHistoryVersions
    );
    if (result.conflicts.length > 0) {
      return this._createPlan("conflict", diskResult, result.conflicts);
    }

    const merged = this.vault._getNormalizedCopyOfData(result.merged);
    if (
      equal(this.createBaseline(merged), this.createBaseline(diskResult.data))
    ) {
      this.vault._installData(diskResult.data);
      this.vault.sessionRevision += 1;
      this.vault._setDiskHashFromCiphertext(diskResult.bytes);
      this.vault._refreshSyncBaseline();
    } else {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      await this.vault._atomicWriteData(merged, {
        incrementRevision: true,
        expectedDiskFingerprint: diskResult.diskFingerprint,
        expectedSessionRevision: this.vault.sessionRevision,
      });
    }
    this.clearPlan();
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return { status: "merged", changed: true };
  }

  async resolveReconciliation({
    reconciliationId,
    decision,
  }: { reconciliationId?: string; decision?: string } = {}) {
    this.vault._ensureUnlocked();
    const plan = this.pendingPlan;
    if (!plan || plan.id !== reconciliationId) {
      const error = new Error("Invalid reconciliation plan");
      error.code = "VAULT_INVALID_RECONCILIATION_PLAN";
      throw error;
    }
    if (
      (decision !== "use_disk" && decision !== "keep_session") ||
      !plan.allowedDecisions.includes(decision)
    ) {
      const error = new Error("Invalid reconciliation decision");
      error.code = "VAULT_INVALID_RECONCILIATION_DECISION";
      throw error;
    }

    const currentDiskFingerprint = diskMarker(this.vault.vaultPath);
    if (
      plan.sessionRevision !== this.vault.sessionRevision ||
      plan.diskFingerprint !== currentDiskFingerprint
    ) {
      this.clearPlan();
      return { status: "superseded" };
    }

    if (decision === "use_disk") {
      if (!plan.diskData || !plan.diskBytes) {
        const error = new Error("Invalid reconciliation plan");
        error.code = "VAULT_INVALID_RECONCILIATION_PLAN";
        throw error;
      }
      this.vault._installData(
        this.vault._getNormalizedCopyOfData(plan.diskData)
      );
      this.vault.sessionRevision += 1;
      this.vault._setDiskHashFromCiphertext(plan.diskBytes);
      this.vault._refreshSyncBaseline();
    } else {
      // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
      await this.vault._atomicWriteData(plan.sessionData, {
        incrementRevision: true,
        expectedDiskFingerprint: plan.diskFingerprint,
        expectedSessionRevision: plan.sessionRevision,
      });
    }
    this.clearPlan();
    // eslint-disable-next-line sort-keys -- Preserve the established serialized field order and protocol/fixture identities.
    return { status: "resolved", decision };
  }
}

export = VaultReconciliation;
