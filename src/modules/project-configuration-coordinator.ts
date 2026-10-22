import type { BoundaryValue } from "./env-text-import-types";
import { isFunctionValue } from "./env-text-import-validation";
import { ConfigReviewFlows } from "./project-configuration-review-flows";
import { captureBinding, expireHandles } from "./project-configuration-support";
import type {
  ConfigCoordinatorState,
  ConfigHandleInput,
  ConfigTargetInput,
  ConfigurationFailure,
  ReviewTarget as ReviewTargetType,
} from "./project-configuration-types";
import type { ReviewSession } from "./review-contracts";

// Class and type-only namespace intentionally share the exported name.
// eslint-disable-next-line no-redeclare
class ProjectConfigurationCoordinator {
  session: ReviewSession;
  now: () => Date;
  _state: ConfigCoordinatorState;
  _reviews: ConfigReviewFlows;

  constructor({
    session,
    now = () => new Date(),
  }: { session?: ReviewSession; now?: () => Date } = {}) {
    if (!session || !isFunctionValue(session.withActiveSession)) {
      throw new TypeError("session is required");
    }
    if (!isFunctionValue(now)) {
      throw new TypeError("now must be a function");
    }
    const state: ConfigCoordinatorState = {
      bindings: new Map(),
      generation: 0,
      handles: new Map(),
      now,
      session,
    };
    this.session = session;
    this.now = now;
    this._state = state;
    this._reviews = new ConfigReviewFlows(state);
  }

  get(target: ConfigTargetInput) {
    return this._reviews.get(target);
  }

  /** Captures Environment identity and the baseline revision before the native file picker opens. */
  captureTarget(
    target: ConfigTargetInput
  ): Promise<{ success: true; binding: string } | ConfigurationFailure> {
    return captureBinding(this._state, target);
  }

  preview(
    target: ConfigTargetInput,
    input: BoundaryValue,
    targetBinding?: BoundaryValue
  ) {
    return this._reviews.preview(target, input, targetBinding);
  }

  previewClear(target: ConfigTargetInput) {
    return this._reviews.previewClear(target);
  }

  commit(handle: ConfigHandleInput) {
    return this._reviews.commit(handle);
  }

  // Keep the public Promise API, including rejection of synchronous failures.
  // eslint-disable-next-line require-await
  async discard(handle: ConfigHandleInput): Promise<{ success: true }> {
    expireHandles(this._state, handle);
    return { success: true };
  }

  clear() {
    const state = this._state;
    state.generation += 1;
    state.handles.clear();
    state.bindings.clear();
  }
}

// Type-only namespace preserves the existing CommonJS public type API.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace ProjectConfigurationCoordinator {
  export interface Target {
    projectName: string;
    environmentId: string;
  }
  export type ReviewTargetInfo = ReviewTargetType;
  export type Failure = ConfigurationFailure;
}

export = ProjectConfigurationCoordinator;
