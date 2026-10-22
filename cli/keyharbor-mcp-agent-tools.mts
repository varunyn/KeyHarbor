import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  closeAgentSession,
  createAgentSession,
  getAgentRequestPathname,
  requestThroughAgentProxy,
} from "./agent-proxy-client.js";
import {
  optionalEnvironment,
  optionalVault,
  projectName,
  secretKey,
  toolError,
  toolResult,
} from "./keyharbor-mcp-protocol.mjs";
import type { ToolCall } from "./keyharbor-mcp-protocol.mjs";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const registerAgentTools = (server: McpServer, client: ToolCall) => {
  server.registerTool(
    "create_agent_session",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create a short-lived HTTPS proxy session for one project secret. Requires explicit approval in KeyHarbor. The returned proxy endpoint is a scoped credential; keep it private and close the session when finished.",
      inputSchema: z.object({
        allowPrivateNetwork: z.boolean().optional(),
        authHeader: z.string().optional(),
        authPrefix: z.string().optional(),
        environmentName: optionalEnvironment,
        key: secretKey,
        methods: z.array(z.string()).optional(),
        origin: z.string().url(),
        pathPrefixes: z.array(z.string()).optional(),
        projectName,
        ttlSeconds: z.number().int().positive().optional(),
        upstreamCaCertificate: z.string().optional(),
        vaultName: optionalVault,
      }),
      title: "Create an approved agent session",
    },
    async (input) => {
      try {
        const response = await client("createAgentSession", { ...input });
        if (!isRecord(response) || response.success !== true) {
          return toolError(
            "KeyHarbor could not create an approved agent session."
          );
        }
        if (response.data === null || response.data === undefined) {
          return toolResult({});
        }
        if (!isRecord(response.data)) {
          return toolError(
            "KeyHarbor could not create an approved agent session."
          );
        }
        return toolResult(response.data);
      } catch {
        return toolError(
          "KeyHarbor could not create an approved agent session."
        );
      }
    }
  );

  server.registerTool(
    "close_agent_session",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: "Revoke an agent proxy session immediately.",
      inputSchema: z.object({ sessionId: z.string().min(1) }),
      title: "Close an agent session",
    },
    async ({ sessionId }) => {
      try {
        const response = await client("closeAgentSession", { sessionId });
        if (!isRecord(response) || response.success !== true) {
          return toolError("KeyHarbor could not close the agent session.");
        }
        if (response.data === null || response.data === undefined) {
          return toolResult({});
        }
        if (!isRecord(response.data)) {
          return toolError("KeyHarbor could not close the agent session.");
        }
        return toolResult(response.data);
      } catch {
        return toolError("KeyHarbor could not close the agent session.");
      }
    }
  );

  server.registerTool(
    "authenticated_request",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Make one HTTPS request through a temporary, explicitly approved KeyHarbor agent session. Each of the connection and request approvals allows 120 seconds; configure the MCP client tool-call timeout to at least 300000 ms. Redirects are not followed; request and response bodies are bounded.",
      inputSchema: z.object({
        allowPrivateNetwork: z.boolean().optional(),
        authHeader: z.string().optional(),
        authPrefix: z.string().optional(),
        body: z
          .string()
          .max(256 * 1024)
          .optional(),
        environmentName: optionalEnvironment,
        key: secretKey,
        method: z.string().regex(/^[A-Za-z]+$/u),
        origin: z.string().url(),
        path: z.string().startsWith("/"),
        projectName,
        upstreamCaCertificate: z.string().optional(),
        vaultName: optionalVault,
      }),
      title: "Make an approved authenticated request",
    },
    async ({
      projectName: project,
      key,
      origin,
      path,
      method,
      environmentName: envName,
      vaultName,
      body,
      allowPrivateNetwork,
      upstreamCaCertificate,
      authHeader,
      authPrefix,
    }) => {
      let session: Awaited<ReturnType<typeof createAgentSession>> | undefined;
      try {
        const pathPrefix = getAgentRequestPathname(origin, path);
        const originUrl = new URL(origin);
        session = await createAgentSession(client, {
          key,
          methods: [method.toUpperCase()],
          origin: originUrl.origin,
          pathPrefixes: [pathPrefix],
          projectName: project,
          ...(envName ? { environmentName: envName } : {}),
          ...(vaultName ? { vaultName } : {}),
          ...(allowPrivateNetwork === undefined ? {} : { allowPrivateNetwork }),
          ...(upstreamCaCertificate ? { upstreamCaCertificate } : {}),
          ...(authHeader === undefined ? {} : { authHeader }),
          ...(authPrefix === undefined ? {} : { authPrefix }),
        });
        const response = await requestThroughAgentProxy({
          ...(body === undefined ? {} : { body }),
          caCertificate: session.caCertificate,
          method,
          origin: originUrl.origin,
          path,
          proxyUrl: session.proxyUrl,
        });
        return toolResult({ ...response });
      } catch {
        return toolError("The approved HTTPS request failed.");
      } finally {
        if (session) {
          await closeAgentSession(client, session.sessionId);
        }
      }
    }
  );
};
