import type { BoundaryValue } from "./env-text-import-types";
import { isRecordValue, isStringValue } from "./env-text-import-validation";
import type {
  ConfigTargetInput,
  ConfigTargetSelector,
  ValidTemplateInput,
} from "./project-configuration-types";

export const validConfigTarget = (
  target: ConfigTargetInput
): target is ConfigTargetSelector => {
  if (!isRecordValue(target) || Array.isArray(target)) {
    return false;
  }
  if (Object.hasOwn(target, "environmentName")) {
    return false;
  }
  const { projectName, environmentId } = target;
  return (
    isStringValue(projectName) &&
    projectName.trim().length > 0 &&
    projectName.length <= 256 &&
    isStringValue(environmentId) &&
    environmentId.length > 0
  );
};

export const validTemplateInput = (
  input: BoundaryValue
): input is ValidTemplateInput => {
  if (!isRecordValue(input)) {
    return false;
  }
  const { source } = input;
  return source === "text" || source === "file";
};
