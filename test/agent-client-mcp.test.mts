import assert from "node:assert/strict";
import test from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createKeyHarborMcpServer } from "../cli/keyharbor-mcp.mjs";

test("secretless MCP mode retains metadata and agent tools without direct secret access", async (t) => {
  const server = createKeyHarborMcpServer(
    () => Promise.resolve({ data: {}, success: true }),
    { secretless: true }
  );
  const client = new Client({
    name: "keyharbor-secretless-test",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const { tools } = await client.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  assert.ok(names.has("keyharbor_status"));
  assert.ok(names.has("list_environments"));
  assert.ok(names.has("create_agent_session"));
  assert.ok(names.has("authenticated_request"));
  for (const name of [
    "list_secret_keys",
    "get_secret",
    "get_secrets",
    "set_secret",
    "set_secrets",
    "create_project",
  ]) {
    assert.equal(
      names.has(name),
      false,
      `${name} must be unavailable in secretless mode`
    );
  }
});

test("agent MCP tools report malformed desktop payloads as tool errors", async (t) => {
  await Promise.all(
    [[], 17, "unexpected"].map(async (data) => {
      const reply = Promise.resolve({ data, success: true });
      const server = createKeyHarborMcpServer(() => reply, {
        secretless: true,
      });
      const client = new Client({
        name: "agent-response-test",
        version: "1.0.0",
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      t.after(async () => {
        await client.close();
        await server.close();
      });
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const created = await client.callTool({
        arguments: {
          key: "API_KEY",
          origin: "https://api.example.test",
          projectName: "demo",
        },
        name: "create_agent_session",
      });
      const closed = await client.callTool({
        arguments: { sessionId: "test-session" },
        name: "close_agent_session",
      });
      for (const result of [created, closed]) {
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent, undefined);
      }
    })
  );
});
