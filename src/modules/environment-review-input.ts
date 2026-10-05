import type { EnvironmentTarget } from "../project/bridge";

interface TextReviewInput {
  content: string;
  source: "text";
}

interface FileReviewInput {
  source: "file";
}

const hasExactKeys = (
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
};

export const isTextInput = (input: unknown): input is TextReviewInput =>
  hasExactKeys(input, ["source", "content"]) &&
  input.source === "text" &&
  typeof input.content === "string";

export const isFileInput = (input: unknown): input is FileReviewInput =>
  hasExactKeys(input, ["source"]) && input.source === "file";

export const validTarget = (target: unknown): target is EnvironmentTarget =>
  hasExactKeys(target, ["projectName", "environmentId"]) &&
  typeof target.projectName === "string" &&
  target.projectName.trim().length > 0 &&
  target.projectName.length <= 256 &&
  typeof target.environmentId === "string" &&
  target.environmentId.length > 0;
