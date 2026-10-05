#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const keyHarborClient = require("./keyharbor-client");

const { KEYHARBOR_DIR, getServerInfo, isElectronAppRunning, sendRequest } =
  keyHarborClient;
/** Environment names follow the domain rule so a typo can never resolve to another Environment. */
const ENVIRONMENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const CHILD_SEPARATOR = "--";

interface ParsedArguments {
  vaultName: string | null;
  environmentName: string | null;
  args: string[];
  childArgs: string[];
  separatorIndex: number;
  error: string | null;
}

type SecretView = { value?: string | null } | string;

const parseArguments = (rawArgs: string[]): ParsedArguments => {
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
const parsed = parseArguments(process.argv.slice(2));
const { vaultName } = parsed;
const { environmentName } = parsed;
const { args } = parsed;
const [command] = args;

const withVault = (data) => (vaultName ? { ...data, vaultName } : data);
const withSelectors = (data) => ({
  ...withVault(data),
  ...(environmentName ? { environmentName } : {}),
});
const showHelp = () => {
  console.log(`
KeyHarbor

Usage:
  keyharbor [--vault=<name>] [--env=<name>] <command> [options]

Commands:
  run --project=<name> <command>    Run command with environment variables
  get <project> <key>               Get a secret value
  set <project> <key> <value>       Set a secret value
  create <project>                  Create a new project (succeeds if it already exists)
  list                              List all projects
  environments <project>            List the Project's Environments (metadata only)
  vaults                            List all vaults
  mcp                               Start the local MCP v2 stdio server
  help                              Show this help message

Options:
  --vault=<name>                    Specify vault (default: System)
  --env=<name>                      Select an Environment (default: Project default)

  KeyHarbor options are only parsed before "--". Everything after "--" is
  forwarded to the child command untouched.

Examples:
  keyharbor run --project=myapp --env=dev -- npm start
  keyharbor get myapp API_KEY --env=prod
  keyharbor get myapp API_KEY
  keyharbor set myapp API_KEY "sk-1234567890" --env=dev
  keyharbor create myapp
  keyharbor list
  keyharbor environments myapp
  keyharbor --vault="Work" list
  keyharbor --vault="Work" get api API_KEY
  keyharbor vaults
  keyharbor mcp
`);
};
const handleRun = async () => {
  const projectIndex = args.findIndex((arg) => arg.startsWith("--project="));
  if (projectIndex === -1) {
    console.error("Error: --project flag is required");
    process.exit(1);
  }
  const [, projectName] = args[projectIndex].split("=");
  let commandToRun = args.slice(projectIndex + 1);
  const separatorIndex = commandToRun.indexOf(CHILD_SEPARATOR);
  if (separatorIndex !== -1) {
    commandToRun = commandToRun.slice(separatorIndex + 1);
  }
  if (commandToRun.length === 0) {
    console.error("Error: No command to run");
    process.exit(1);
  }
  try {
    const vaultLabel = vaultName ? ` (vault: ${vaultName})` : "";
    const environmentLabel = environmentName
      ? `, environment "${environmentName}"`
      : "";
    console.log(
      `Requesting approval for secrets from project "${projectName}"${environmentLabel}${vaultLabel}...`
    );
    const response = await sendRequest(
      "getAllSecrets",
      withSelectors({ projectName })
    );
    if (!response.success) {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
    const secrets: Record<string, SecretView> = response.data || {};
    const approvedCount = Object.keys(secrets).length;
    if (approvedCount === 0) {
      console.log(
        `No secrets found in project "${projectName}". Running command without environment variables...`
      );
    } else {
      console.log(`${approvedCount} secret(s) approved.`);
    }
    const env = { ...process.env };
    for (const [key, secret] of Object.entries(secrets)) {
      env[key] = String(
        secret && typeof secret === "object" && Object.hasOwn(secret, "value")
          ? (secret.value ?? "")
          : (secret ?? "")
      );
    }
    const [cmd, ...cmdArgs] = commandToRun;
    console.log(`\nRunning command: ${commandToRun.join(" ")}\n`);
    const child = spawn(cmd, cmdArgs, {
      env,
      // Allow shell features like pipes, conjunctions, and redirects.
      shell: true,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`Failed to start command: ${error.message}`);
      process.exit(1);
    });
    child.on("exit", (code) => {
      process.exit(typeof code === "number" ? code : 1);
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const handleGet = async () => {
  if (args.length < 3) {
    console.error("Usage: keyharbor get <project> <key>");
    process.exit(1);
  }
  const [projectName, key] = args.slice(1);
  try {
    const response = await sendRequest(
      "getSecret",
      withSelectors({ key, projectName })
    );
    if (response.success) {
      console.log(response.data?.value ?? response.data);
    } else {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const handleSet = async () => {
  if (args.length < 4) {
    console.error("Usage: keyharbor set <project> <key> <value>");
    process.exit(1);
  }
  const [projectName, key, value] = args.slice(1);
  try {
    const response = await sendRequest(
      "setSecret",
      withSelectors({ key, projectName, value })
    );
    if (response.success) {
      const environmentLabel = environmentName
        ? ` in environment "${environmentName}"`
        : "";
      console.log(
        `Secret "${key}" set successfully in project "${projectName}"${environmentLabel}`
      );
    } else {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const handleEnvironments = async () => {
  if (args.length < 2) {
    console.error("Usage: keyharbor environments <project>");
    process.exit(1);
  }
  const [projectName] = args.slice(1);
  try {
    const response = await sendRequest(
      "listEnvironments",
      withVault({ projectName })
    );
    if (response.success) {
      const environments = response.data;
      if (!Array.isArray(environments) || environments.length === 0) {
        console.log(`No environments found in project "${projectName}"`);
      } else {
        console.log(`Environments in project "${projectName}":`);
        for (const environment of environments) {
          const defaultMarker = environment.isDefault ? " (default)" : "";
          console.log(
            `  ${environment.name}${defaultMarker} — ${environment.secretCount} secret(s)`
          );
        }
      }
    } else {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const handleVaults = async () => {
  try {
    const response = await sendRequest("listVaults", {});
    if (response.success) {
      const vaults = response.data;
      if (vaults.length === 0) {
        console.log("No vaults found");
      } else {
        console.log("Vaults:");
        for (const vault of vaults) {
          const offlineMarker = vault.status === "offline" ? " (offline)" : "";
          console.log(`  ${vault.name}${offlineMarker} — ${vault.path}`);
        }
      }
    } else {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const handleCreate = async () => {
  if (args.length < 2) {
    console.error("Usage: keyharbor create <project>");
    process.exit(1);
  }
  const [projectName] = args.slice(1);
  // Project creation is a grouping operation, so an explicit --env is rejected
  // rather than silently ignored.
  if (environmentName) {
    console.error(
      "Error: --env is not valid for project creation. Environments are managed in the KeyHarbor desktop app."
    );
    process.exit(1);
  }
  try {
    const response = await sendRequest(
      "createProject",
      withVault({ projectName })
    );
    if (response.success) {
      if (response.data && response.data.created === false) {
        console.log(`Project "${projectName}" already exists`);
      } else {
        console.log(`Project "${projectName}" created successfully`);
      }
    } else {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const handleList = async () => {
  try {
    const response = await sendRequest("listProjects", withVault({}));
    if (response.success) {
      const projects = response.data;
      if (projects.length === 0) {
        console.log("No projects found");
      } else {
        console.log("Projects:");
        for (const project of projects) {
          const environmentLabel = Number.isInteger(project.environmentCount)
            ? `, ${project.environmentCount} environment(s)`
            : "";
          console.log(
            `  ${project.name} (${project.secretCount} secrets${environmentLabel})`
          );
        }
      }
    } else {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
const main = async () => {
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }
  if (["help", "--help", "-h"].includes(command)) {
    showHelp();
    return;
  }
  if (command === "mcp") {
    const { runKeyHarborMcpServer } = await import("./keyharbor-mcp.mjs");
    runKeyHarborMcpServer();
    return;
  }
  if (!fs.existsSync(KEYHARBOR_DIR)) {
    console.error(
      "Error: KeyHarbor is not set up. Please run the GUI application first."
    );
    process.exit(1);
  }
  const isRunning = await isElectronAppRunning();
  if (!isRunning) {
    console.error(
      "Error: KeyHarbor app is not running. Please start the GUI application first."
    );
    process.exit(1);
  }
  switch (command) {
    case "run": {
      await handleRun();
      break;
    }
    case "get": {
      await handleGet();
      break;
    }
    case "set": {
      await handleSet();
      break;
    }
    case "create": {
      await handleCreate();
      break;
    }
    case "list": {
      await handleList();
      break;
    }
    case "environments": {
      await handleEnvironments();
      break;
    }
    case "vaults": {
      await handleVaults();
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
    }
  }
};
/** Omitted Environment selectors stay omitted so the server applies its fixed default. */
/** Metadata-only Environment discovery. Never Environment-scoped and never returns values. */
process.on("uncaughtException", (error) => {
  console.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});
if (require.main === module) {
  (async () => {
    try {
      await main();
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  })();
}
module.exports = {
  ENVIRONMENT_NAME_PATTERN,
  getServerInfo,
  isElectronAppRunning,
  parseArguments,
  sendRequest,
};
