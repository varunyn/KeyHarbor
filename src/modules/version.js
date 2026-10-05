const SEMVER_PATTERN =
  /^(?:v)?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const DIGITS_PATTERN = /^\d+$/u;

const parseVersion = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  };
};

const comparePrerelease = (left, right) => {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) {
      return 0;
    }
    return left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) {
      return -1;
    }
    if (right[index] === undefined) {
      return 1;
    }
    if (left[index] === right[index]) {
      continue;
    }
    const leftNumeric = DIGITS_PATTERN.test(left[index]);
    const rightNumeric = DIGITS_PATTERN.test(right[index]);
    if (leftNumeric && rightNumeric) {
      return Number(left[index]) > Number(right[index]) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return left[index] > right[index] ? 1 : -1;
  }
  return 0;
};

const compareVersions = (leftValue, rightValue) => {
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

const isNewerVersion = (candidate, current) =>
  compareVersions(candidate, current) === 1;

module.exports = { compareVersions, isNewerVersion };
