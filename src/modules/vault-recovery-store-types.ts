type RecoveryKind = "manager_config" | "vault";

type RecoveryErrorCode =
  | "VAULT_RECOVERY_AUTH_FAILED"
  | "VAULT_RECOVERY_IDENTITY_MISMATCH"
  | "VAULT_RECOVERY_INVALID"
  | "VAULT_RECOVERY_INVALID_KEY"
  | "VAULT_RECOVERY_NOT_FOUND"
  | "VAULT_RECOVERY_TOO_LARGE"
  | "VAULT_RECOVERY_UNSAFE_PATH";

interface CapsuleHeader {
  algorithm: "aes-256-gcm";
  artifactId: string;
  capsuleId: string;
  formatVersion: 1;
  generation: number;
  kind: RecoveryKind;
  nonce: string;
  pathDigest: string | null;
  vaultId: string | null;
  vaultInstanceId: string;
}

interface CapsuleEnvelope {
  ciphertext: string;
  header: CapsuleHeader;
  tag: string;
}

interface CapsuleIdentityFields {
  artifactId: string;
  pathDigest: string | null;
  vaultId: string | null;
}

interface CapsuleReadResult {
  header: CapsuleHeader;
  payload: RecoveryPayload;
}

/**
 * JSON object sealed inside a recovery capsule. Its concrete shape depends on
 * the capsule kind; consumers parse it at their own boundary.
 */
type RecoveryPayload = Record<string, unknown>;

interface RecoveryStoreOptions {
  maxRecordBytes?: number;
}

interface WriteCapsuleRequest<TPayload extends object = RecoveryPayload> {
  artifactId: string;
  generation: number;
  key: Buffer;
  kind?: RecoveryKind;
  payload: TPayload;
  vaultId?: string | null;
  vaultInstanceId: string | null;
  vaultPath?: string | null;
}

type RecoveryError = Error & { code: RecoveryErrorCode };

export type {
  CapsuleEnvelope,
  CapsuleHeader,
  CapsuleIdentityFields,
  CapsuleReadResult,
  RecoveryError,
  RecoveryErrorCode,
  RecoveryKind,
  RecoveryPayload,
  RecoveryStoreOptions,
  WriteCapsuleRequest,
};
