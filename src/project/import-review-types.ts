import type { BridgeResult } from "./bridge";

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
