/** Environment names follow the domain rule so a typo can never resolve to another Environment. */
export const ENVIRONMENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
export const CHILD_SEPARATOR = "--";

export interface ParsedArguments {
  vaultName: string | null;
  environmentName: string | null;
  args: string[];
  childArgs: string[];
  separatorIndex: number;
  error: string | null;
}

export const parseArguments = (rawArgs: string[]): ParsedArguments => {
  const separatorIndex = rawArgs.indexOf(CHILD_SEPARATOR);
  const localOptionLimit =
    separatorIndex === -1 ? rawArgs.length : separatorIndex;
  const args: string[] = [];
  let vaultName: string | null = null;
  let environmentName: string | null = null;
  let error: string | null = null;
  for (const [index, arg] of rawArgs.entries()) {
    // Everything at or after `--` belongs to the child command and is never
    // interpreted as a KeyHarbor selector.
    if (index >= localOptionLimit) {
      args.push(arg);
      continue;
    }
    if (arg === "--vault" || arg === "--env") {
      error = `${arg} requires a value, for example ${arg}=name`;
      continue;
    }
    if (arg.startsWith("--vault=")) {
      const value = arg.slice("--vault=".length);
      if (!value.trim()) {
        error ||= "--vault requires a non-empty name";
        vaultName = null;
        continue;
      }
      if (vaultName !== null) {
        error = "--vault was provided more than once";
        vaultName = null;
        continue;
      }
      vaultName = value;
      continue;
    }
    if (arg.startsWith("--env=")) {
      const value = arg.slice("--env=".length);
      if (!value.trim()) {
        error ||= "--env requires a non-empty Environment name";
        environmentName = null;
        continue;
      }
      if (!ENVIRONMENT_NAME_PATTERN.test(value)) {
        // An explicit malformed selector must never silently degrade to
        // the Project default.
        error = `Invalid Environment name "${value}". Use lowercase letters, digits, hyphen, or underscore, starting with a letter.`;
        environmentName = null;
        continue;
      }
      if (environmentName !== null) {
        error = "--env was provided more than once";
        environmentName = null;
        continue;
      }
      environmentName = value;
      continue;
    }
    args.push(arg);
  }
  return {
    args,
    childArgs: separatorIndex === -1 ? [] : rawArgs.slice(separatorIndex + 1),
    environmentName,
    error,
    separatorIndex,
    vaultName,
  };
};
