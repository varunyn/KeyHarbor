export interface BridgeFailure {
  success: false;
  error?: string;
  code?: string;
  cancelled?: boolean;
}

export type BridgeResult<T extends object = Record<never, never>> =
  | ({ success: true } & T)
  | BridgeFailure;
export type DataResult<T> = BridgeResult<{ data: T }>;

export interface SecretMetadata {
  description?: string;
  tags?: string[];
}

export type EnvironmentTarget = Readonly<{
  projectName: string;
  environmentId: string;
}>;

export interface SecretRecord {
  value: string;
  expiresAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  description: string;
  tags: string[];
}

export interface SecretVersion {
  value: string;
  expiresAt: string | null;
  description: string;
  tags: string[];
  changedAt: string | null;
  isCurrent: boolean;
}

export interface SecretHistory {
  current: SecretVersion;
  history: SecretVersion[];
  totalVersions: number;
}

export interface ProjectRecord {
  name: string;
  secretCount: number;
  environmentCount: number;
  defaultEnvironmentId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  secretCount: number;
  isDefault: boolean;
}

export type AppTheme = "system" | "light" | "dark";

export interface ThemeChangePayload {
  theme: AppTheme;
  shouldUseDarkColors: boolean;
}

export interface ThemeBridge {
  get: () => Promise<ThemeChangePayload>;
  onThemeChanged: (callback: (data: ThemeChangePayload) => void) => Unsubscribe;
}

export interface AppSettings {
  checkForUpdates: boolean;
  locale: string;
  showStatistics: boolean;
  theme: AppTheme;
  autoLock: { enabled: boolean; timeout: number };
  screenCaptureProtection: boolean;
  vaultDiskSyncIntervalSeconds: number;
  touchIdUnlockEnabled: boolean;
  __loadStatus?: "ok" | "repaired" | "reset";
  __repairs?: string[];
}

export interface VaultListEntry {
  id: string;
  name: string;
  path: string;
  isSystem: boolean;
  isActive: boolean;
  status: "active" | "locked" | "offline" | "failed" | string;
}
export interface VaultRegistration {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface CliCheckResult {
  installed: boolean;
  path?: string;
}
export type CliActionResult = BridgeResult<{ message: string }>;

export interface FavoriteSnapshot {
  projects: string[];
  secrets: Record<string, Record<string, string[]>>;
}

export interface AccessLogTarget {
  vaultId?: string | null;
  vaultInstanceId?: string | null;
  projectName: string;
  environmentId: string;
  environmentName: string;
  key?: string;
  action: string;
  /** "approved" is completed access; denials and closed reviews are recorded as "denied". */
  outcome?: "approved" | "denied";
}

export interface ActivityLog {
  timestamp: string;
  category: string;
  message: string;
  /** Absent on legacy unscoped entries, which are never guessed into an Environment. */
  target?: AccessLogTarget;
}

export type ExportMode = "example" | "references" | "raw";
export interface ExportOptions {
  password?: string;
}
/** Whole-Project backup is a separate operation and is not an Environment export mode. */
export type ProjectBackupMode = "backup";

export type ImportInput =
  | { source: "text"; content: string }
  | { source: "file" };

export interface ReviewDiagnostic {
  line: number;
  code: string;
  message: string;
}

export interface ReviewTarget {
  vaultName: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

export interface ImportOccurrence {
  id: string;
  line: number;
  empty: boolean;
  status: "new" | "identical" | "changed";
  defaultAction: "add" | "skip";
}

export interface ImportPreviewEntry {
  key: string;
  occurrences: ImportOccurrence[];
  duplicate: boolean;
}

export type ImportPreviewResult = BridgeResult<{
  handle: string | null;
  target: ReviewTarget | null;
  entries: ImportPreviewEntry[];
  diagnostics: ReviewDiagnostic[];
}>;

export interface ImportDecision {
  key: string;
  occurrenceId: string | null;
  action: "add" | "replace" | "skip";
}

export type ConfigurationStatus = "Ready" | "Missing" | "Empty" | "Expired";
export interface ConfigurationEntry {
  key: string;
  status: ConfigurationStatus;
}
export interface ConfigurationCounts {
  required: number;
  ready: number;
  missing: number;
  empty: number;
  expired: number;
}

export interface ConfigurationChanges {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export type ConfigurationResult =
  | BridgeResult<{ configured: false; target: ReviewTarget }>
  | BridgeResult<{
      configured: true;
      target: ReviewTarget;
      counts: ConfigurationCounts;
      entries: ConfigurationEntry[];
      evaluatedAt: string;
      nextExpiry: string | null;
    }>;

export type ConfigurationPreviewResult = BridgeResult<{
  handle: string | null;
  target: ReviewTarget | null;
  entries: ConfigurationEntry[];
  changes: ConfigurationChanges | null;
  duplicateNames: number;
  diagnostics: ReviewDiagnostic[];
}>;

export type ConfigurationClearPreviewResult = BridgeResult<{
  handle: string;
  target: ReviewTarget;
  removed: string[];
  secretsRemain: true;
}>;

export interface ProjectBridge {
  secrets: {
    get: (
      target: EnvironmentTarget,
      key: string
    ) => Promise<DataResult<SecretRecord>>;
    getAll: (
      target: EnvironmentTarget
    ) => Promise<DataResult<Record<string, SecretRecord>>>;
    set: (
      target: EnvironmentTarget,
      key: string,
      value: string,
      expiresAt?: string | null,
      meta?: SecretMetadata
    ) => Promise<BridgeResult>;
    update: (
      target: EnvironmentTarget,
      fromKey: string,
      toKey: string,
      value: string,
      expiresAt?: string | null,
      meta?: SecretMetadata
    ) => Promise<BridgeResult>;
    rename: (
      target: EnvironmentTarget,
      fromKey: string,
      toKey: string
    ) => Promise<BridgeResult>;
    delete: (target: EnvironmentTarget, key: string) => Promise<BridgeResult>;
    export: (
      target: EnvironmentTarget,
      mode?: ExportMode,
      options?: ExportOptions
    ) => Promise<BridgeResult<{ path: string }>>;
    importPreview: (
      target: EnvironmentTarget,
      input: ImportInput
    ) => Promise<ImportPreviewResult>;
    importReveal: (
      handle: string,
      key: string,
      occurrenceId: string
    ) => Promise<BridgeResult<{ value: string }>>;
    importCommit: (
      handle: string,
      decisions: ImportDecision[]
    ) => Promise<
      BridgeResult<{
        count: number;
        added: number;
        replaced: number;
        skipped: number;
      }>
    >;
    importDiscard: (handle: string) => Promise<BridgeResult>;
    getHistory: (
      target: EnvironmentTarget,
      key: string
    ) => Promise<DataResult<SecretHistory>>;
    restoreVersion: (
      target: EnvironmentTarget,
      key: string,
      versionIndex: number
    ) => Promise<BridgeResult>;
  };
  projects: {
    get: () => Promise<DataResult<ProjectRecord[]>>;
    environments: (
      projectName: string
    ) => Promise<DataResult<EnvironmentSummary[]>>;
    createEnvironment: (
      projectName: string,
      name: string
    ) => Promise<BridgeResult<{ environment: EnvironmentSummary }>>;
    renameEnvironment: (
      target: EnvironmentTarget,
      name: string
    ) => Promise<BridgeResult<{ environment: EnvironmentSummary }>>;
    deleteEnvironment: (
      target: EnvironmentTarget,
      replacementDefaultEnvironmentId?: string
    ) => Promise<
      BridgeResult<{
        deletedEnvironmentId: string;
        affectedSecretCount: number;
        defaultEnvironmentId: string;
      }>
    >;
    create: (name: string) => Promise<BridgeResult>;
    delete: (name: string) => Promise<BridgeResult>;
    /** Encrypted whole-Project backup containing every Environment. */
    backup: (projectName: string) => Promise<BridgeResult<{ path: string }>>;
    configurationGet: (
      target: EnvironmentTarget
    ) => Promise<ConfigurationResult>;
    configurationPreview: (
      target: EnvironmentTarget,
      input: ImportInput
    ) => Promise<ConfigurationPreviewResult>;
    configurationClearPreview: (
      target: EnvironmentTarget
    ) => Promise<ConfigurationClearPreviewResult>;
    configurationCommit: (handle: string) => Promise<
      BridgeResult<{
        kind: "replace" | "clear";
        changed: boolean;
        requiredCount: number;
        addedCount: number;
        removedCount: number;
        unchangedCount: number;
      }>
    >;
    configurationDiscard: (handle: string | null) => Promise<BridgeResult>;
  };
  vault: {
    instanceIdentity: () => Promise<DataResult<{ vaultInstanceId: string }>>;
    list: () => Promise<DataResult<VaultListEntry[]>>;
    switch: (vaultId: string) => Promise<BridgeResult>;
    create: (
      name: string,
      folderPath: string,
      password: string
    ) => Promise<DataResult<VaultRegistration>>;
    import: (
      name: string,
      lkvPath: string,
      password: string
    ) => Promise<DataResult<VaultRegistration>>;
    rename: (vaultId: string, newName: string) => Promise<BridgeResult>;
    remove: (vaultId: string) => Promise<BridgeResult>;
    lock: () => Promise<
      BridgeResult<{ state: VaultSessionState; outcome?: string }>
    >;
    sessionSnapshot: () => Promise<VaultSessionSnapshot>;
    onSessionStateChanged: (
      callback: (snapshot: VaultSessionSnapshot) => void
    ) => Unsubscribe;
    onVaultDataSynced: (callback: () => void) => Unsubscribe;
    onReconciliationRequired: (
      callback: (payload: unknown) => void
    ) => Unsubscribe;
    reconcileExternalChange: (
      origin: "save" | "periodic" | "focus" | "external-notification"
    ) => Promise<ReconciliationResponse>;
    resolveReconciliation: (
      reconciliationId: string,
      decision: "use_disk" | "keep_session"
    ) => Promise<ReconciliationResponse>;
  };
  favorites: { get: () => Promise<BridgeResult<{ data: FavoriteSnapshot }>> };
  favorite: {
    toggleProject: (
      projectName: string
    ) => Promise<BridgeResult<{ added: boolean }>>;
    toggleSecret: (
      target: EnvironmentTarget,
      secretKey: string
    ) => Promise<BridgeResult<{ added: boolean }>>;
  };
  logs: { get: () => Promise<BridgeResult<{ data: ActivityLog[] }>> };
  statistics: { get: () => Promise<BridgeResult<{ data: ProjectStatistics }>> };
  i18n: {
    getTranslations: () => Promise<{
      locale: string;
      translations: Record<string, unknown>;
    }>;
    onLocaleChanged: (
      callback: (data: {
        locale?: string;
        translations?: Record<string, unknown>;
      }) => void
    ) => Unsubscribe;
  };
  theme: ThemeBridge;
  settings: { get: () => Promise<AppSettings> };
  dialog: { selectFolder: () => Promise<DataResult<string | null>> };
  cli: {
    check: () => Promise<CliCheckResult>;
    install: () => Promise<CliActionResult>;
    uninstall: () => Promise<CliActionResult>;
  };
  navigate: (page: "dashboard" | "setup" | "lock") => Promise<BridgeResult>;
  onWindowFocusChanged: (callback: (focused: boolean) => void) => Unsubscribe;
}

export interface ProjectStatistics {
  totalProjects: number;
  totalSecrets: number;
  expiringSecrets: number;
  hasExpired: boolean;
  recentAccessCount: number;
}

export type VaultSessionState =
  | "locked"
  | "opening"
  | "active"
  | "recovering"
  | "closing"
  | "destroying";
export interface VaultSessionSnapshot {
  state: VaultSessionState;
  transitionId: number;
  reason: string | null;
  activeVaultId?: string | null;
  recovery: unknown[];
  warnings: unknown[];
}

export interface ReconciliationConflict {
  kind: string;
  project: string;
  environmentId?: string;
  environmentName?: string;
  sessionEnvironmentId?: string;
  sessionEnvironmentName?: string;
  diskEnvironmentId?: string;
  diskEnvironmentName?: string;
  key?: string;
  reason: string;
  sessionPreview?: string;
  diskPreview?: string;
  sessionRequiredKeys?: string[] | null;
  diskRequiredKeys?: string[] | null;
}
export interface ReconciliationPlan {
  status: "needs_resolution" | "merged" | "resolved" | "superseded" | string;
  reconciliationId?: string;
  reason?: string;
  allowedDecisions?: ("use_disk" | "keep_session")[];
  conflicts?: ReconciliationConflict[];
}
export type ReconciliationResponse = BridgeResult<
  ReconciliationPlan & { result?: ReconciliationPlan }
>;

export interface TouchIdStatus {
  available: boolean;
  enabled: boolean;
}
/** Captured approval target shown to the user; never contains values. */
export interface ApprovalRequest {
  vaultName?: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  keys?: string[];
  action?: "read" | "write";
  channel?: string;
}

export interface SettingsBridge {
  get: () => Promise<AppSettings>;
  set: (settings: Partial<AppSettings>) => Promise<BridgeResult>;
}

export type KeyHarborBridge = ProjectBridge & {
  vault: ProjectBridge["vault"] & {
    setup: (password: string) => Promise<BridgeResult>;
    unlock: (password: string) => Promise<BridgeResult>;
    changePassword: (
      currentPassword: string,
      newPassword: string
    ) => Promise<BridgeResult>;
    verifyPassword: (password: string) => Promise<BridgeResult>;
    delete: () => Promise<BridgeResult>;
    exists: () => Promise<boolean>;
    lock: () => Promise<
      BridgeResult<{ state: VaultSessionState; outcome?: string }>
    >;
  };
  settings: SettingsBridge;
  touchId: {
    getStatus: () => Promise<TouchIdStatus>;
    setEnabled: (
      enabled: boolean
    ) => Promise<BridgeResult<{ status?: TouchIdStatus }>>;
    unlock: () => Promise<BridgeResult<{ status?: TouchIdStatus }>>;
  };
  logs: ProjectBridge["logs"] & {
    clear: () => Promise<BridgeResult>;
    export: () => Promise<BridgeResult<{ path?: string; cancelled?: boolean }>>;
  };
  i18n: ProjectBridge["i18n"];
  cli: ProjectBridge["cli"];
  navigate: (page: "dashboard" | "setup" | "lock") => Promise<BridgeResult>;
};

export type Unsubscribe = () => void;
