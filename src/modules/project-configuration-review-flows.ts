import type { BoundaryValue, CodedError } from "./env-text-import-types";
import { isRecordValue, isStringValue } from "./env-text-import-validation";
import {
  evaluate,
  evaluateSnapshot,
  readTemplate,
} from "./project-configuration-evaluation";
import {
  assertFresh,
  baselineIdentity,
  describeTarget,
  describeTargetOrNull,
  failure,
  publicTarget,
  randomHandle,
  remember,
  safeError,
  safeMessage,
  sameBindingTarget,
  sameTarget,
} from "./project-configuration-support";
import type {
  ConfigCoordinatorState,
  ConfigHandleInput,
  ConfigTargetInput,
  ConfigTargetSelector,
  ConfigurationBinding,
  ValidTemplateInput,
} from "./project-configuration-types";
import {
  validConfigTarget,
  validTemplateInput,
} from "./project-configuration-validation";
import type {
  ReviewBaseline,
  ReviewBaselineSnapshot,
  ReviewVault,
} from "./review-contracts";

export class ConfigReviewFlows {
  _state: ConfigCoordinatorState;

  constructor(state: ConfigCoordinatorState) {
    this._state = state;
  }

  async get(target: ConfigTargetInput) {
    const state = this._state;
    if (!validConfigTarget(target)) {
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    try {
      return await state.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const baseline = activeVault.getProjectConfigurationBaseline(target);
          if (!baseline.exists) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const identity = describeTarget(
            state.session,
            activeVault,
            target,
            baseline
          );
          if (!baseline.configurationBaseline) {
            return {
              configured: false,
              success: true,
              target: publicTarget(identity),
            };
          }
          // SAFETY: configurationBaseline is non-null after the guard above; narrow for evaluation.
          const narrowed = baseline as ReviewBaselineSnapshot & {
            configurationBaseline: ReviewBaseline;
          };
          return evaluate(activeVault, target, narrowed, identity, state.now());
        }
      );
    } catch (error) {
      // SAFETY: coordinator failures carry a machine-readable code; unknown throws fall back to evaluation failure.
      const { code } = error as CodedError;
      return failure(
        code || "CONFIGURATION_EVALUATION_FAILED",
        safeMessage({ code })
      );
    }
  }

  async preview(
    target: ConfigTargetInput,
    input: BoundaryValue,
    targetBinding?: BoundaryValue
  ) {
    const state = this._state;
    const { generation } = state;
    const abandonBinding = () => {
      if (isStringValue(targetBinding)) {
        state.bindings.delete(targetBinding);
      }
    };
    if (!validConfigTarget(target)) {
      abandonBinding();
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    if (!isRecordValue(input) || !validTemplateInput(input)) {
      abandonBinding();
      return failure(
        "CONFIGURATION_INVALID_INPUT",
        "Choose text or a file to review."
      );
    }
    const candidate: ValidTemplateInput = input;
    const selector: ConfigTargetSelector = target;

    let template;
    try {
      template = await readTemplate(candidate);
    } catch (error) {
      abandonBinding();
      // SAFETY: template failures carry a machine-readable code; type errors map to invalid UTF-8.
      const { code } = error as CodedError;
      return failure(
        code ||
          (error instanceof TypeError
            ? "CONFIGURATION_INVALID_UTF8"
            : "CONFIGURATION_FILE_READ_FAILED"),
        safeMessage({ code })
      );
    }
    if (generation !== state.generation) {
      abandonBinding();
      return failure(
        "CONFIGURATION_PREVIEW_INVALID",
        safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
      );
    }

    if (template.diagnostics.length > 0) {
      abandonBinding();
      return {
        changes: null,
        diagnostics: template.diagnostics,
        duplicateNames: 0,
        entries: [],
        handle: null,
        success: true,
        target: null,
      };
    }

    const { requiredKeys, duplicateNames } = template;

    try {
      const result = await state.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) =>
          this._buildPreview(
            activeVault,
            selector,
            targetBinding,
            generation,
            requiredKeys,
            duplicateNames
          )
      );
      if (generation !== state.generation) {
        if (result?.handle) {
          state.handles.delete(result.handle);
        }
        abandonBinding();
        return failure(
          "CONFIGURATION_PREVIEW_INVALID",
          safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
        );
      }
      return result;
    } catch (error) {
      abandonBinding();
      // SAFETY: coordinator failures carry a machine-readable code; unknown throws fall back to unavailable.
      const { code } = error as CodedError;
      return failure(
        code || "CONFIGURATION_TARGET_UNAVAILABLE",
        safeMessage({ code })
      );
    }
  }

  _buildPreview(
    activeVault: ReviewVault | null,
    target: ConfigTargetSelector,
    targetBinding: BoundaryValue | undefined,
    generation: number,
    requiredKeys: string[],
    duplicateNames: number
  ) {
    const state = this._state;
    if (!activeVault || activeVault.isLocked) {
      throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
    }
    // A binding captured before native selection that no longer resolves
    // (delete/recreate) is a stale review, never an unresolved default.
    let binding: ConfigurationBinding | undefined;
    if (targetBinding !== undefined) {
      if (!isStringValue(targetBinding)) {
        throw safeError("CONFIGURATION_STALE");
      }
      binding = state.bindings.get(targetBinding);
      state.bindings.delete(targetBinding);
      if (!binding || binding.generation !== generation) {
        throw safeError("CONFIGURATION_STALE");
      }
      const currentTarget = describeTargetOrNull(
        state.session,
        activeVault,
        target
      );
      if (
        !currentTarget ||
        !sameTarget(binding.target, currentTarget) ||
        !sameBindingTarget(
          state.session,
          activeVault,
          target,
          binding.baselineIdentity
        )
      ) {
        throw safeError("CONFIGURATION_STALE");
      }
    }
    const baseline = activeVault.getProjectConfigurationBaseline(target);
    if (!baseline.exists) {
      throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
    }
    const targetIdentity = describeTarget(
      state.session,
      activeVault,
      target,
      baseline
    );
    if (binding && !sameTarget(binding.target, targetIdentity)) {
      throw safeError("CONFIGURATION_STALE");
    }
    if (generation !== state.generation) {
      throw safeError("CONFIGURATION_PREVIEW_INVALID");
    }

    const previous: string[] =
      baseline.configurationBaseline?.requiredKeys || [];
    const previousSet = new Set(previous);
    const nextSet = new Set(requiredKeys);
    const changes = {
      added: requiredKeys.filter((key) => !previousSet.has(key)),
      removed: previous.filter((key) => !nextSet.has(key)),
      unchanged: requiredKeys.filter((key) => previousSet.has(key)),
    };
    const snapshot = activeVault.getImportProjectSnapshot(target, requiredKeys);
    const evaluated = evaluateSnapshot(
      requiredKeys,
      // SAFETY: Vault snapshot secrets are internal validated records; narrow for evaluation.
      snapshot.secrets as Record<string, BoundaryValue>,
      state.now()
    );
    const entries = requiredKeys.map((key) => ({
      key,
      status:
        evaluated.entries.find((entry) => entry.key === key)?.status ||
        "Missing",
    }));
    const handle = randomHandle();
    remember(state.handles, handle, {
      baselineIdentity: baselineIdentity(baseline.configurationBaseline),
      changeCounts: {
        added: changes.added.length,
        removed: changes.removed.length,
        required: requiredKeys.length,
        unchanged: changes.unchanged.length,
      },
      environmentIncarnation: baseline.environmentIncarnation,
      generation,
      incarnation: baseline.incarnation,
      kind: "replace",
      requiredKeys,
      // SAFETY: Vault snapshot secrets are internal validated records; store them for freshness comparison.
      secrets: snapshot.secrets as Record<string, BoundaryValue>,
      selector: { ...target },
      target: targetIdentity,
    });
    return {
      changes,
      diagnostics: [],
      duplicateNames,
      entries,
      handle,
      success: true,
      target: publicTarget(targetIdentity),
    };
  }

  async previewClear(target: ConfigTargetInput) {
    const state = this._state;
    if (!validConfigTarget(target)) {
      return failure(
        "CONFIGURATION_INVALID_TARGET",
        "Choose a valid Project and Environment."
      );
    }
    const selector: ConfigTargetSelector = target;
    const { generation } = state;
    try {
      const result = await state.session.withActiveSession(
        ({ activeVault }: { activeVault: ReviewVault | null }) => {
          if (!activeVault || activeVault.isLocked) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          const baseline =
            activeVault.getProjectConfigurationBaseline(selector);
          if (!baseline.exists) {
            throw safeError("CONFIGURATION_TARGET_UNAVAILABLE");
          }
          if (!baseline.configurationBaseline) {
            throw safeError("CONFIGURATION_NOT_CONFIGURED");
          }
          const targetIdentity = describeTarget(
            state.session,
            activeVault,
            selector,
            baseline
          );
          const snapshot = activeVault.getImportProjectSnapshot(
            selector,
            baseline.configurationBaseline.requiredKeys
          );
          const handle = randomHandle();
          remember(state.handles, handle, {
            baselineIdentity: baselineIdentity(baseline.configurationBaseline),
            changeCounts: {
              added: 0,
              removed: baseline.configurationBaseline.requiredKeys.length,
              required: 0,
              unchanged: 0,
            },
            environmentIncarnation: baseline.environmentIncarnation,
            generation,
            incarnation: baseline.incarnation,
            kind: "clear",
            requiredKeys: [],
            // SAFETY: Vault snapshot secrets are internal validated records; store them for freshness comparison.
            secrets: snapshot.secrets as Record<string, BoundaryValue>,
            selector: { ...selector },
            target: targetIdentity,
          });
          return {
            handle,
            removed: [...baseline.configurationBaseline.requiredKeys],
            secretsRemain: true,
            success: true,
            target: publicTarget(targetIdentity),
          };
        }
      );
      if (generation !== state.generation) {
        if (result?.handle) {
          state.handles.delete(result.handle);
        }
        return failure(
          "CONFIGURATION_PREVIEW_INVALID",
          safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
        );
      }
      return result;
    } catch (error) {
      // SAFETY: coordinator failures carry a machine-readable code; unknown throws fall back to unavailable.
      const { code } = error as CodedError;
      return failure(
        code || "CONFIGURATION_TARGET_UNAVAILABLE",
        safeMessage({ code })
      );
    }
  }

  async commit(handle: ConfigHandleInput) {
    const state = this._state;
    const review = isStringValue(handle)
      ? state.handles.get(handle)
      : undefined;
    if (!review) {
      return failure(
        "CONFIGURATION_PREVIEW_INVALID",
        safeMessage(safeError("CONFIGURATION_PREVIEW_INVALID"))
      );
    }
    if (isStringValue(handle)) {
      state.handles.delete(handle);
    }
    try {
      return await state.session.withActiveSession(
        async ({ activeVault }: { activeVault: ReviewVault | null }) => {
          assertFresh(state, activeVault, review);
          const expected = {
            baseline: review.baselineIdentity,
            environmentIncarnation: review.environmentIncarnation,
            incarnation: review.incarnation,
            // Revalidates Environment identity immediately before the write.
            validateTarget: () => assertFresh(state, activeVault, review),
          };
          const applied =
            review.kind === "clear"
              ? await activeVault.clearProjectConfigurationBaseline(
                  review.selector,
                  expected
                )
              : await activeVault.replaceProjectConfigurationBaseline(
                  review.selector,
                  review.requiredKeys,
                  expected
                );
          return {
            addedCount: review.changeCounts.added,
            changed: applied.changed,
            kind: review.kind,
            removedCount: review.changeCounts.removed,
            requiredCount: review.changeCounts.required,
            success: true,
            unchangedCount: review.changeCounts.unchanged,
          };
        }
      );
    } catch (error) {
      // SAFETY: commit failures carry a machine-readable code; unknown throws map to a commit failure.
      const { code } = error as CodedError;
      return failure(
        code || "CONFIGURATION_COMMIT_FAILED",
        safeMessage({ code })
      );
    }
  }
}
