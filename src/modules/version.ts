interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

const SEMVER_PATTERN =
  /^(?:v)?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const DIGITS_PATTERN = /^\d+$/u;

const isString = (value: unknown): value is string => typeof value === "string";

const parseVersion = (value: unknown): ParsedVersion | null => {
  if (!isString(value)) {
    return null;
  }
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return {
    core: [major, minor, patch],
    prerelease: match[4] ? match[4].split(".") : [],
  };
};

const comparePrerelease = (left: string[], right: string[]): number => {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) {
      return 0;
    }
    return left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumeric = DIGITS_PATTERN.test(leftPart);
    const rightNumeric = DIGITS_PATTERN.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
};

export const compareVersions = (
  leftValue: unknown,
  rightValue: unknown
): number | null => {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) {
    return null;
  }
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};

export const isNewerVersion = (candidate: unknown, current: unknown): boolean =>
  compareVersions(candidate, current) === 1;
