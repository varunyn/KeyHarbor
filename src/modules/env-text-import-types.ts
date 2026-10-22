/** Shared domain types for env text import reviews. */
import type { ReviewSession } from "./review-contracts";

export interface BoundaryRecord {
  readonly [key: string]: BoundaryValue;
}

export type BoundaryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly BoundaryValue[]
  | BoundaryRecord;

export interface ImportTargetSelector {
  projectName: string;
  environmentId: string;
  readonly [key: string]: BoundaryValue;
}

export type ImportTargetInput = BoundaryValue;

export type ImportDecisionsInput = BoundaryValue;

export type ImportHandleInput = BoundaryValue;

export type ImportSelectorInput = BoundaryValue;

/** Public review target: identity plus display labels, never persisted. */
export interface ReviewTarget {
  vaultName: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

export type ImportOccurrenceStatus = "new" | "identical" | "changed";

export interface ImportOccurrence {
  id: string;
  line: number;
  empty: boolean;
  status: ImportOccurrenceStatus;
  defaultAction: "add" | "skip";
  value: string;
}

export type ImportDecisionAction = "add" | "replace" | "skip";

export interface ImportDecision {
  key: string;
  occurrenceId: string | null;
  action: ImportDecisionAction;
}

export interface ImportPreviewEntry {
  key: string;
  occurrences: Omit<ImportOccurrence, "value">[];
  duplicate: boolean;
}

export interface ImportFailure {
  success: false;
  code: string;
  error: string;
  cancelled?: boolean;
  readonly [key: string]: BoundaryValue;
}

export interface CodedError extends Error {
  code?: string;
}

export type ImportPreviewResult =
  | (ImportFailure & { cancelled?: boolean })
  | {
      success: true;
      handle: string | null;
      target: ReviewTarget | null;
      entries: ImportPreviewEntry[];
      diagnostics: { line: number; code: string; message: string }[];
    };

export type ImportCommitResult =
  | {
      success: true;
      count: number;
      added: number;
      replaced: number;
      skipped: number;
    }
  | ImportFailure;

/**
 * Identity binding captured before native selection. It includes the
 * Environment ID, name and incarnation so a rename, delete or recreate in a
 * different Environment never silently retargets an outstanding review.
 */
export interface TargetBinding {
  transitionId: number | string;
  activeVaultId: string | null;
  vaultId: string | null;
  vaultInstanceId: string | null;
  projectName: string;
  projectIncarnation: string | null;
  environmentId: string;
  environmentName: string;
  environmentIncarnation: string | null;
  vaultName: string;
}

export type ImportSecretSnapshot = string | { readonly value?: string } | null;

export interface ImportPreview {
  target: TargetBinding;
  projectName: string;
  projectIncarnation: string | null;
  environmentIncarnation: string | null;
  generation: number;
  selector: ImportTargetSelector;
  secrets: Record<string, ImportSecretSnapshot>;
  entries: Map<string, ImportOccurrence[]>;
}

export interface ImportInputCandidate {
  readonly source?: BoundaryValue;
  readonly content?: BoundaryValue;
  readonly filePath?: BoundaryValue;
}

export interface ValidImportInput {
  readonly source: "text" | "file";
  readonly content?: BoundaryValue;
  readonly filePath?: BoundaryValue;
  readonly [key: string]: BoundaryValue;
}

export interface FolderScanState {
  target: TargetBinding;
  selector: ImportTargetSelector;
  contents: Map<string, string>;
}

export interface FolderHandoff {
  directory: string;
  target: TargetBinding;
  expiresAt: number;
}

export interface ImportCoordinatorState {
  session: ReviewSession;
  previews: Map<string, ImportPreview>;
  targetBindings: Map<string, TargetBinding>;
  generation: number;
  folderHandoff: FolderHandoff | null;
  folderScans: Map<string, FolderScanState>;
}
