import type { BoundaryValue } from "./env-text-import-types";
import type { ReviewSession } from "./review-contracts";

/** Public review target: identity plus display labels, never persisted. */
export interface ReviewTarget {
  vaultName: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

export type ConfigurationStatus = "Ready" | "Missing" | "Empty" | "Expired";

export interface BaselineIdentity {
  exists: boolean;
  revision: string | null;
}

export interface ConfigTargetSelector {
  projectName: string;
  environmentId: string;
  readonly [key: string]: BoundaryValue;
}

export type ConfigTargetInput = BoundaryValue;

export type ConfigHandleInput = BoundaryValue;

/**
 * Identity captured before native selection and revalidated immediately before
 * the queued mutation. Environment ID, name and incarnation are part of it, so
 * a rename, delete or recreate retires the outstanding review.
 */
export interface ReviewBinding {
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

export interface ConfigurationReview {
  target: ReviewBinding;
  kind: "replace" | "clear";
  selector: ConfigTargetSelector;
  incarnation: string | null;
  environmentIncarnation: string | null;
  baselineIdentity: BaselineIdentity;
  secrets: Record<string, BoundaryValue>;
  requiredKeys: string[];
  changeCounts: {
    required: number;
    added: number;
    removed: number;
    unchanged: number;
  };
  generation: number;
}

export interface ConfigurationBinding {
  generation: number;
  target: ReviewBinding;
  baselineIdentity: BaselineIdentity;
}

export interface ConfigurationFailure {
  success: false;
  code: string;
  error: string;
  readonly [key: string]: BoundaryValue;
}

export interface ConfigStoredSecret {
  value: string;
  expiresAt?: string | null;
  readonly [key: string]: BoundaryValue;
}

export interface TemplateDiagnostics {
  line: number;
  code: string;
  message: string;
}

export interface TemplateResult {
  requiredKeys: string[];
  duplicateNames: number;
  diagnostics: TemplateDiagnostics[];
}

export interface TemplateInput {
  readonly source: BoundaryValue;
  readonly content?: BoundaryValue;
  readonly filePath?: BoundaryValue;
  readonly [key: string]: BoundaryValue;
}

export interface ValidTemplateInput {
  readonly source: "text" | "file";
  readonly content?: BoundaryValue;
  readonly filePath?: BoundaryValue;
  readonly [key: string]: BoundaryValue;
}

export interface ConfigCoordinatorState {
  session: ReviewSession;
  now: () => Date;
  handles: Map<string, ConfigurationReview>;
  bindings: Map<string, ConfigurationBinding>;
  generation: number;
}
