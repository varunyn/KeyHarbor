#!/usr/bin/env node
"use strict";
import {
  CHILD_SEPARATOR,
  ENVIRONMENT_NAME_PATTERN,
  parseArguments,
} from "./keyharbor-arguments";
import { showHelp } from "./keyharbor-help";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const keyHarborClient = require("./keyharbor-client");
const agentProxyClient = require("./agent-proxy-client");

const { KEYHARBOR_DIR, getServerInfo, isElectronAppRunning, sendRequest } =
  keyHarborClient;
type SecretView = { value?: string | null } | string;
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
// eslint-disable-next-line complexity -- This handler owns approval, child lifetime, revocation, and CA cleanup.
const handleAgent = async () => {
  const { separatorIndex } = parsed;
  if (separatorIndex === -1 || parsed.childArgs.length === 0) {
    console.error(
      "Usage: keyharbor agent --project=<name> --key=<key> --origin=https://api.example.com -- <command> [args]"
    );
    process.exitCode = 1;
    return;
  }
  const { argv } = process;
  const options = argv.slice(2, 2 + separatorIndex).slice(1);
  const getOption = (name) =>
    options.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const projectName = getOption("project");
  const key = getOption("key");
  const origin = getOption("origin");
  if (
    !projectName ||
    !key ||
    !origin ||
    options.filter((arg) => arg.startsWith("--project=")).length !== 1 ||
    options.filter((arg) => arg.startsWith("--key=")).length !== 1 ||
    options.filter((arg) => arg.startsWith("--origin=")).length !== 1
  ) {
    console.error(
      "Error: agent requires exactly one --project, --key, and --origin option before --."
    );
    process.exitCode = 1;
    return;
  }
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    originUrl = null;
  }
  if (
    !originUrl ||
    originUrl.protocol !== "https:" ||
    originUrl.pathname !== "/" ||
    originUrl.search ||
    originUrl.hash ||
    originUrl.username ||
    originUrl.password
  ) {
    console.error(
      "Error: --origin must be an HTTPS origin, such as https://api.example.com."
    );
    process.exitCode = 1;
    return;
  }
  const request = {
    key,
    origin: originUrl.origin,
    projectName,
    ...(environmentName ? { environmentName } : {}),
    ...(vaultName ? { vaultName } : {}),
    ...(options.some((arg) => arg.startsWith("--auth-header="))
      ? { authHeader: getOption("auth-header") }
      : {}),
    ...(options.some((arg) => arg.startsWith("--auth-prefix="))
      ? { authPrefix: getOption("auth-prefix") }
      : {}),
  };
  let session;
  let directory;
  let child;
  const signalHandlers = new Map();
  try {
    const response = await sendRequest("createAgentSession", request);
    if (!response.success) {
      throw new Error(
        "Agent session approval was denied or could not be created."
      );
    }
    session = response.data;
    if (
      !session ||
      typeof session.sessionId !== "string" ||
      typeof session.proxyUrl !== "string" ||
      typeof session.caCertificate !== "string" ||
      typeof session.placeholder !== "string"
    ) {
      throw new Error("KeyHarbor returned an invalid approved session.");
    }
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "keyharbor-agent-"));
    fs.chmodSync(directory, 0o700);
    const caPath = agentProxyClient.writePublicCa(
      directory,
      session.caCertificate
    );
    const env = agentProxyClient.createAgentEnvironment(session);
    agentProxyClient.addCaEnvironment(env, caPath);
    env[key] = session.placeholder;
    const [cmd, ...cmdArgs] = parsed.childArgs;
    child = spawn(cmd, cmdArgs, { env, shell: false, stdio: "inherit" });
    const forwardSignal = (signal) => {
      child?.kill(signal);
      const killTimer = setTimeout(() => child?.kill("SIGKILL"), 5000);
      killTimer.unref();
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => forwardSignal(signal);
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    const exit: { code: number | null; signal: NodeJS.Signals | null } =
      // eslint-disable-next-line promise/avoid-new -- ChildProcess exposes close/error events.
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) =>
          resolve({ code, signal } as {
            code: number | null;
            signal: NodeJS.Signals | null;
          })
        );
      });
    process.exitCode =
      exit.signal || typeof exit.code !== "number" ? 1 : exit.code;
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : "Agent command failed."}`
    );
    process.exitCode = 1;
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    if (session?.sessionId) {
      await agentProxyClient.closeAgentSession(sendRequest, session.sessionId);
    }
    if (directory) {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  }
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
    runKeyHarborMcpServer(args.includes("--secretless"));
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
    case "agent": {
      await handleAgent();
      break;
    }
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
