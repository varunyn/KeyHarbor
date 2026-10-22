import type {
  BoundaryValue,
  ImportDecision,
  ImportDecisionsInput,
  ImportOccurrence,
  ImportTargetInput,
  ImportTargetSelector,
  ValidImportInput,
} from "./env-text-import-types";

export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const ACTIONS = new Set(["add", "replace", "skip"]);

export const isStringValue = (value: BoundaryValue): value is string =>
  typeof value === "string";

export const isFunctionValue = (
  value: unknown
): value is (...args: never[]) => void => typeof value === "function";

export const isRecordValue = (
  value: BoundaryValue
): value is Record<string, BoundaryValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validProjectName = (name: BoundaryValue): name is string =>
  isStringValue(name) && name.trim().length > 0 && name.length <= 256;

export const validTarget = (
  target: ImportTargetInput
): target is ImportTargetSelector => {
  if (!isRecordValue(target) || Array.isArray(target)) {
    return false;
  }
  if (Object.hasOwn(target, "environmentName")) {
    return false;
  }
  const { projectName, environmentId } = target;
  return (
    validProjectName(projectName) &&
    isStringValue(environmentId) &&
    environmentId.length > 0
  );
};

export const validChoice = (
  key: BoundaryValue,
  occurrenceId: BoundaryValue
): key is string =>
  isStringValue(key) && KEY_PATTERN.test(key) && isStringValue(occurrenceId);

export const validFilePath = (filePath: BoundaryValue): filePath is string =>
  isStringValue(filePath) && filePath.length > 0;

export const validInput = (input: BoundaryValue): input is ValidImportInput => {
  if (!isRecordValue(input)) {
    return false;
  }
  const { source } = input;
  return source === "text" || source === "file";
};

const isDecisionAction = (
  action: BoundaryValue
): action is ImportDecision["action"] =>
  isStringValue(action) && ACTIONS.has(action);

export const validateDecisions = (
  entries: Map<string, ImportOccurrence[]>,
  decisions: ImportDecisionsInput
): ImportDecision[] | null => {
  if (!Array.isArray(decisions) || decisions.length !== entries.size) {
    return null;
  }
  const seen = new Set<string>();
  const normalized: ImportDecision[] = [];
  for (const decision of decisions) {
    if (!isRecordValue(decision)) {
      return null;
    }
    const { key, action, occurrenceId } = decision;
    if (
      !isStringValue(key) ||
      !KEY_PATTERN.test(key) ||
      !entries.has(key) ||
      seen.has(key)
    ) {
      return null;
    }
    if (!isDecisionAction(action)) {
      return null;
    }
    const occurrences = entries.get(key);
    if (!occurrences) {
      return null;
    }
    if (
      action === "skip" &&
      (occurrenceId === null || occurrenceId === undefined)
    ) {
      normalized.push({
        action: "skip",
        key,
        occurrenceId: null,
      });
    } else {
      if (
        !isStringValue(occurrenceId) ||
        !occurrences.some(({ id }) => id === occurrenceId)
      ) {
        return null;
      }
      if (occurrences.length > 1 && action !== "skip" && !occurrenceId) {
        return null;
      }
      normalized.push({
        action,
        key,
        occurrenceId,
      });
    }
    seen.add(key);
  }
  return seen.size === entries.size ? normalized : null;
};
