#!/usr/bin/env node

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// Node ESM imports the default from this TypeScript export= CommonJS client.
// eslint-disable-next-line import/default
import keyHarborClient from "./keyharbor-client.js";

const { sendRequest } = keyHarborClient;
const { version: APP_VERSION } = createRequire(import.meta.url)(
  "../package.json"
) as {
  version: string;
};

type ToolCall = (
  action: string,
  data: Record<string, unknown>
) => Promise<unknown>;

const optionalVault = z
  .string()
  .min(1)
  .optional()
  .describe("Vault name. Omit to use the System vault.");
const optionalEnvironment = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u)
  .optional()
  .describe(
    "Environment name. Omit to use the Project's fixed default Environment. Never inferred from the desktop selection or NODE_ENV."
  );
const projectName = z.string().min(1).describe("KeyHarbor project name.");
const secretKey = z.string().min(1).describe("Secret key.");

const secretSchema = z.object({
  createdAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable(),
  updatedAt: z.string().nullable().optional(),
  value: z.string(),
});

const environmentSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  isDefault: z.boolean(),
  name: z.string(),
  secretCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};

/**
 * Omits the Environment selector entirely when it was not supplied so the
 * server applies its fixed default instead of the caller guessing one.
 */
const requestData = (
  vaultName: string | undefined,
  data: Record<string, unknown> = {},
  environmentName?: string
) => ({
  ...data,
  ...(vaultName ? { vaultName } : {}),
  ...(environmentName === undefined ? {} : { environmentName }),
});

const toolError = (message: string): CallToolResult => ({
  content: [{ text: message, type: "text" }],
  isError: true,
});

const callKeyHarbor = async (
  client: ToolCall,
  action: string,
  data: Record<string, unknown> = {}
): Promise<unknown> => {
  try {
    const response = (await client(action, data)) as
      | { success?: boolean; data?: unknown; error?: string }
      | undefined;
    if (!response?.success) {
      return toolError(response?.error || "KeyHarbor request failed");
    }
    return response.data;
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
};

const toolResult = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ text: JSON.stringify(data), type: "text" }],
  structuredContent: data,
});

const isToolError = (value: unknown): value is CallToolResult =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as { isError?: unknown }).isError === true
  );

export const createKeyHarborMcpServer = (
  client: ToolCall = sendRequest as ToolCall
) => {
  const server = new McpServer(
    { name: "keyharbor", version: APP_VERSION },
    {
      instructions:
        "KeyHarbor stores secrets locally. Each Project contains independent Environments. Project creation, secret-key listing, reads, and writes require explicit approval in the KeyHarbor desktop app. Discover Environments with list_environments and select one explicitly with environmentName when the user asks for a non-default Environment; omitting environmentName always targets the Project's fixed default. Request only the minimum secrets needed and never echo secret values unless the user explicitly asks.",
    }
  );

  server.registerTool(
    "keyharbor_status",
    {
      annotations: readOnlyAnnotations,
      description:
        "Check whether the KeyHarbor desktop vault is unlocked and available.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        environmentProtocolVersion: z.number().int().positive(),
        isUnlocked: z.boolean(),
        version: z.string(),
      }),
      title: "Get KeyHarbor status",
    },
    async () => {
      const data = await callKeyHarbor(client, "status");
      return isToolError(data)
        ? data
        : toolResult((data ?? {}) as Record<string, unknown>);
    }
  );

  server.registerTool(
    "list_vaults",
    {
      annotations: readOnlyAnnotations,
      description:
        "List configured KeyHarbor vaults without returning secret values.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        vaults: z.array(
          z.object({
            id: z.string(),
            isActive: z.boolean(),
            isSystem: z.boolean(),
            name: z.string(),
            path: z.string(),
            status: z.string(),
          })
        ),
      }),
      title: "List KeyHarbor vaults",
    },
    async () => {
      const data = await callKeyHarbor(client, "listVaults");
      return isToolError(data) ? data : toolResult({ vaults: data });
    }
  );

  server.registerTool(
    "list_projects",
    {
      annotations: readOnlyAnnotations,
      description:
        "List projects with aggregate secret counts and Environment counts. Counts are summed across all of a Project's Environments. Returns no secret keys or values.",
      inputSchema: z.object({ vaultName: optionalVault }),
      outputSchema: z.object({
        projects: z.array(
          z.object({
            createdAt: z.string().optional(),
            defaultEnvironmentId: z.string(),
            environmentCount: z.number().int().positive(),
            name: z.string(),
            secretCount: z.number().int().nonnegative(),
            updatedAt: z.string().optional(),
          })
        ),
      }),
      title: "List KeyHarbor projects",
    },
    async ({ vaultName }) => {
      const data = await callKeyHarbor(
        client,
        "listProjects",
        requestData(vaultName)
      );
      return isToolError(data) ? data : toolResult({ projects: data });
    }
  );

  server.registerTool(
    "list_environments",
    {
      annotations: readOnlyAnnotations,
      description:
        "List the Environments of one Project with names, IDs, secret counts, and which one is the default. Metadata only; never returns secret keys or values and never requires approval. Use this before choosing an explicit environmentName. Does not accept an Environment selector.",
      // Strict so a supplied Environment selector is an explicit error
      // rather than being silently dropped.
      inputSchema: z.object({ projectName, vaultName: optionalVault }).strict(),
      outputSchema: z.object({ environments: z.array(environmentSchema) }),
      title: "List a project's Environments",
    },
    async ({ projectName: project, vaultName }) => {
      const data = await callKeyHarbor(
        client,
        "listEnvironments",
        requestData(vaultName, { projectName: project })
      );
      return isToolError(data) ? data : toolResult({ environments: data });
    }
  );

  server.registerTool(
    "create_project",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create a new project with one empty default Environment. Requires explicit write approval in the desktop app. Succeeds without changes if the project already exists. Project creation is not Environment-scoped; call list_environments afterwards. Call this before set_secret when the project may not exist yet.",
      // Project creation is not Environment-scoped; an Environment selector is an explicit error.
      inputSchema: z.object({ projectName, vaultName: optionalVault }).strict(),
      outputSchema: z.object({
        created: z.boolean(),
        success: z.literal(true),
      }),
      title: "Create a KeyHarbor project",
    },
    async ({ projectName: project, vaultName }) => {
      const data = await callKeyHarbor(
        client,
        "createProject",
        requestData(vaultName, { projectName: project })
      );
      if (isToolError(data)) {
        return data;
      }
      const created =
        data && typeof (data as { created?: unknown }).created === "boolean"
          ? (data as { created: boolean }).created
          : true;
      return toolResult({ created, success: true });
    }
  );

  server.registerTool(
    "list_secret_keys",
    {
      annotations: readOnlyAnnotations,
      description:
        "List secret key names for exactly one Project Environment. Requires approval in KeyHarbor and never returns values. Omit environmentName to list the Project's fixed default Environment; keys are never resolved from another Environment.",
      inputSchema: z.object({
        environmentName: optionalEnvironment,
        projectName,
        vaultName: optionalVault,
      }),
      outputSchema: z.object({ keys: z.array(z.string()) }),
      title: "List secret keys",
    },
    async ({ projectName: project, vaultName, environmentName }) => {
      const data = await callKeyHarbor(
        client,
        "listSecretKeys",
        requestData(vaultName, { projectName: project }, environmentName)
      );
      return isToolError(data) ? data : toolResult({ keys: data });
    }
  );

  server.registerTool(
    "get_secret",
    {
      annotations: readOnlyAnnotations,
      description:
        "Read one secret from exactly one Project Environment. Requires explicit approval in the desktop app. Omit environmentName to read the Project's fixed default Environment. A key missing from the selected Environment fails; it never falls back to another Environment.",
      inputSchema: z.object({
        environmentName: optionalEnvironment,
        key: secretKey,
        projectName,
        vaultName: optionalVault,
      }),
      outputSchema: z.object({ secret: secretSchema }),
      title: "Get a secret",
    },
    async ({ projectName: project, key, vaultName, environmentName }) => {
      const data = await callKeyHarbor(
        client,
        "getSecret",
        requestData(vaultName, { key, projectName: project }, environmentName)
      );
      return isToolError(data) ? data : toolResult({ secret: data });
    }
  );

  server.registerTool(
    "get_secrets",
    {
      annotations: readOnlyAnnotations,
      description:
        "Read selected secrets from exactly one Project Environment in one approval request. Omit environmentName to read the Project's fixed default Environment. Missing keys are omitted rather than read from another Environment.",
      inputSchema: z.object({
        environmentName: optionalEnvironment,
        keys: z
          .array(secretKey)
          .min(1)
          .describe("Exact secret keys to retrieve."),
        projectName,
        vaultName: optionalVault,
      }),
      outputSchema: z.object({ secrets: z.record(z.string(), secretSchema) }),
      title: "Get selected secrets",
    },
    async ({ projectName: project, keys, vaultName, environmentName }) => {
      const data = await callKeyHarbor(
        client,
        "getBatchSecrets",
        requestData(vaultName, { keys, projectName: project }, environmentName)
      );
      return isToolError(data) ? data : toolResult({ secrets: data });
    }
  );

  server.registerTool(
    "set_secret",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create or replace one secret in exactly one Project Environment. Requires explicit write approval in the desktop app. Fails if the project does not exist; call create_project first in that case. Omit environmentName to write the Project's fixed default Environment.",
      inputSchema: z.object({
        environmentName: optionalEnvironment,
        key: secretKey,
        projectName,
        value: z.string().describe("Secret value to store."),
        vaultName: optionalVault,
      }),
      outputSchema: z.object({ success: z.literal(true) }),
      title: "Set a secret",
    },
    async ({
      projectName: project,
      key,
      value,
      vaultName,
      environmentName,
    }) => {
      const data = await callKeyHarbor(
        client,
        "setSecret",
        requestData(
          vaultName,
          { key, projectName: project, value },
          environmentName
        )
      );
      return isToolError(data) ? data : toolResult({ success: true });
    }
  );

  server.registerTool(
    "set_secrets",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create or replace multiple secrets in exactly one Project Environment with a single write approval in the desktop app. Fails if the project does not exist; call create_project first in that case. Omit environmentName to write the Project's fixed default Environment. Useful for seeding one Environment from a .env.example file: read the file, then pass its keys here with empty or placeholder values.",
      inputSchema: z.object({
        environmentName: optionalEnvironment,
        projectName,
        secrets: z
          .record(z.string(), z.string())
          .refine(
            (secrets) => Object.keys(secrets).length > 0,
            "secrets must not be empty"
          )
          .describe("Secret keys mapped to the values to store."),
        vaultName: optionalVault,
      }),
      outputSchema: z.object({
        count: z.number().int().nonnegative(),
        success: z.literal(true),
      }),
      title: "Set multiple secrets",
    },
    async ({ projectName: project, secrets, vaultName, environmentName }) => {
      const data = await callKeyHarbor(
        client,
        "setBatchSecrets",
        requestData(
          vaultName,
          { projectName: project, secrets },
          environmentName
        )
      );
      if (isToolError(data)) {
        return data;
      }
      const count =
        data && typeof (data as { count?: unknown }).count === "number"
          ? (data as { count: number }).count
          : Object.keys(secrets).length;
      return toolResult({ count, success: true });
    }
  );

  return server;
};

export const runKeyHarborMcpServer = () =>
  serveStdio(() => createKeyHarborMcpServer());

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runKeyHarborMcpServer();
}
