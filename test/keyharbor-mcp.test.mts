import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { createKeyHarborMcpServer } from "../cli/keyharbor-mcp.mjs";

const KEYHARBOR_CLI_PATH = fileURLToPath(
  new URL("../cli/keyharbor.js", import.meta.url)
);

interface ToolCall {
  action: string;
  data: Record<string, unknown>;
}
type Responder = (action: string, data: Record<string, unknown>) => unknown;

const createConnectedClient = async (responder: Responder) => {
  const calls: ToolCall[] = [];
  const server = createKeyHarborMcpServer(
    // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
    async (action: string, data: Record<string, unknown>) => {
      calls.push({ action, data });
      return responder(action, data);
    }
  );
  const client = new Client({ name: "keyharbor-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    calls,
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
};

const toolByName = (tools: { name: string }[], name: string) => {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `tool ${name} must be advertised`);
  return tool;
};

test("MCP server advertises Environment discovery and Environment-aware Secret tools", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: {},
    success: true,
  }));
  t.after(() => connection.close());

  const { tools } = await connection.client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "keyharbor_status",
      "list_vaults",
      "list_projects",
      "list_environments",
      "create_project",
      "list_secret_keys",
      "get_secret",
      "get_secrets",
      "set_secret",
      "set_secrets",
    ]
  );

  // Every Secret-related tool, including key listing and bulk writes, accepts environmentName.
  for (const name of [
    "list_secret_keys",
    "get_secret",
    "get_secrets",
    "set_secret",
    "set_secrets",
  ]) {
    const tool = toolByName(tools, name) as {
      inputSchema?: { properties?: Record<string, unknown> };
    };
    assert.ok(
      tool.inputSchema?.properties?.environmentName,
      `${name} must accept environmentName`
    );
  }

  // Project creation and metadata discovery are not Environment-scoped.
  for (const name of ["create_project", "list_environments"]) {
    const tool = toolByName(tools, name) as {
      inputSchema?: { properties?: Record<string, unknown> };
    };
    assert.equal(
      tool.inputSchema?.properties?.environmentName,
      undefined,
      `${name} must not accept environmentName`
    );
  }

  const getSecret = toolByName(tools, "get_secret") as {
    annotations?: Record<string, boolean | undefined>;
  };
  assert.equal(getSecret.annotations?.readOnlyHint, true);
  assert.equal(getSecret.annotations?.openWorldHint, false);

  const setSecret = toolByName(tools, "set_secret") as {
    annotations?: Record<string, boolean | undefined>;
  };
  assert.equal(setSecret.annotations?.readOnlyHint, false);
  assert.equal(setSecret.annotations?.destructiveHint, true);
});

test("stdio entrypoint negotiates the MCP v2 protocol era", async (t) => {
  const client = new Client(
    { name: "keyharbor-v2-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  const transport = new StdioClientTransport({
    args: [KEYHARBOR_CLI_PATH, "mcp"],
    command: process.execPath,
    stderr: "pipe",
  });
  t.after(() => client.close());

  await client.connect(transport);
  assert.equal(client.getProtocolEra(), "modern");
  assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
  const awaitedResult1 = await client.listTools();
  assert.equal(awaitedResult1.tools.length, 10);
});

test("list_environments performs metadata-only discovery without an Environment selector", async (t) => {
  const environments = [
    {
      createdAt: "t0",
      id: "env-1",
      isDefault: true,
      name: "default",
      secretCount: 2,
      updatedAt: "t0",
    },
    {
      createdAt: "t0",
      id: "env-2",
      isDefault: false,
      name: "dev",
      secretCount: 0,
      updatedAt: "t0",
    },
  ];
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: environments,
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { projectName: "demo" },
    name: "list_environments",
  });

  assert.deepEqual(connection.calls, [
    { action: "listEnvironments", data: { projectName: "demo" } },
  ]);
  assert.deepEqual(result.structuredContent, { environments });
  assert.equal(
    JSON.stringify(result.structuredContent).includes("value"),
    false
  );
});

test("list_environments rejects a supplied Environment selector at the schema boundary", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: [],
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { environmentName: "dev", projectName: "demo" },
    name: "list_environments",
  });

  assert.equal(result.isError, true);
  assert.equal(
    connection.calls.length,
    0,
    "an invalid selector must never reach KeyHarbor"
  );
});

test("explicit environmentName reaches the KeyHarbor approval API verbatim", async (t) => {
  const secret = {
    createdAt: "2026-09-22T00:00:00.000Z",
    expiresAt: null,
    updatedAt: "2026-09-22T00:00:00.000Z",
    value: "test-value",
  };
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: secret,
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: {
      environmentName: "dev",
      key: "API_KEY",
      projectName: "demo",
      vaultName: "Work",
    },
    name: "get_secret",
  });

  assert.deepEqual(connection.calls, [
    {
      action: "getSecret",
      data: {
        environmentName: "dev",
        key: "API_KEY",
        projectName: "demo",
        vaultName: "Work",
      },
    },
  ]);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { secret });
});

test("omitted environmentName is omitted on the wire so the fixed default is applied", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: { expiresAt: null, value: "default-value" },
    success: true,
  }));
  t.after(() => connection.close());

  await connection.client.callTool({
    arguments: { key: "API_KEY", projectName: "demo" },
    name: "get_secret",
  });
  await connection.client.callTool({
    arguments: { projectName: "demo" },
    name: "list_secret_keys",
  });
  await connection.client.callTool({
    arguments: { keys: ["API_KEY"], projectName: "demo" },
    name: "get_secrets",
  });
  await connection.client.callTool({
    arguments: { key: "API_KEY", projectName: "demo", value: "v" },
    name: "set_secret",
  });
  await connection.client.callTool({
    arguments: { projectName: "demo", secrets: { A: "1" } },
    name: "set_secrets",
  });

  assert.deepEqual(
    connection.calls.map((call) => call.action),
    [
      "getSecret",
      "listSecretKeys",
      "getBatchSecrets",
      "setSecret",
      "setBatchSecrets",
    ]
  );
  for (const call of connection.calls) {
    assert.equal(
      Object.hasOwn(call.data, "environmentName"),
      false,
      "an omitted selector must stay omitted"
    );
  }
});

test("key listing and bulk writes forward an explicit environmentName", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async (action) => {
    if (action === "setBatchSecrets") {
      return { data: { count: 2 }, success: true };
    }
    if (action === "listSecretKeys") {
      return { data: ["A"], success: true };
    }
    return { data: {}, success: true };
  });
  t.after(() => connection.close());

  await connection.client.callTool({
    arguments: { environmentName: "dev", projectName: "demo" },
    name: "list_secret_keys",
  });
  await connection.client.callTool({
    arguments: {
      environmentName: "prod",
      keys: ["A", "B"],
      projectName: "demo",
    },
    name: "get_secrets",
  });
  await connection.client.callTool({
    arguments: {
      environmentName: "prod",
      projectName: "demo",
      secrets: { A: "1", B: "2" },
    },
    name: "set_secrets",
  });

  assert.deepEqual(connection.calls, [
    {
      action: "listSecretKeys",
      data: { environmentName: "dev", projectName: "demo" },
    },
    {
      action: "getBatchSecrets",
      data: { environmentName: "prod", keys: ["A", "B"], projectName: "demo" },
    },
    {
      action: "setBatchSecrets",
      data: {
        environmentName: "prod",
        projectName: "demo",
        secrets: { A: "1", B: "2" },
      },
    },
  ]);
});

test("an Environment name outside the documented rule is rejected before any request", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: {},
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: {
      environmentName: "Production",
      key: "API_KEY",
      projectName: "demo",
    },
    name: "get_secret",
  });

  assert.equal(result.isError, true);
  assert.equal(connection.calls.length, 0);
});

test("KeyHarbor denials become MCP tool errors without throwing protocol errors", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    error: "Access denied: User denied",
    success: false,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { key: "API_KEY", projectName: "demo" },
    name: "get_secret",
  });

  assert.equal(result.isError, true);
  const [content] = result.content as { text?: string }[];
  assert.equal(content.text, "Access denied: User denied");
});

test("set_secret forwards the value and reports success", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { key: "API_KEY", projectName: "demo", value: "new-value" },
    name: "set_secret",
  });

  assert.deepEqual(connection.calls, [
    {
      action: "setSecret",
      data: { key: "API_KEY", projectName: "demo", value: "new-value" },
    },
  ]);
  assert.deepEqual(result.structuredContent, { success: true });
});

test("create_project forwards the project name and reports whether it was created", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: { created: true },
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { projectName: "demo", vaultName: "Work" },
    name: "create_project",
  });

  assert.deepEqual(connection.calls, [
    {
      action: "createProject",
      data: { projectName: "demo", vaultName: "Work" },
    },
  ]);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { created: true, success: true });
});

test("create_project reports already-existing projects without an error", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: { created: false },
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { projectName: "demo" },
    name: "create_project",
  });

  assert.deepEqual(result.structuredContent, { created: false, success: true });
});

test("set_secrets forwards all pairs in one approval request", async (t) => {
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  const connection = await createConnectedClient(async () => ({
    data: { count: 2 },
    success: true,
  }));
  t.after(() => connection.close());

  const result = await connection.client.callTool({
    arguments: { projectName: "demo", secrets: { API_KEY: "a", DB_URL: "b" } },
    name: "set_secrets",
  });

  assert.deepEqual(connection.calls, [
    {
      action: "setBatchSecrets",
      data: { projectName: "demo", secrets: { API_KEY: "a", DB_URL: "b" } },
    },
  ]);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { count: 2, success: true });
});
