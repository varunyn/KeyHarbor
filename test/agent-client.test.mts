import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { fileURLToPath } from "node:url";

import { requestThroughAgentProxy } from "../cli/agent-proxy-client.js";
import type { AgentSession } from "../cli/agent-proxy-client.js";

type MockDesktopResponseData =
  | Record<string, never>
  | { environmentProtocolVersion: number; isUnlocked: boolean }
  | AgentSession;

test("HTTPS request uses scoped CONNECT authorization and hides proxy credentials on refusal", async (t) => {
  let requestText = "";
  const proxy = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      requestText = chunk.toString("latin1");
      socket.end(
        "HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n"
      );
    });
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(() => proxy.close());
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");

  await assert.rejects(
    requestThroughAgentProxy({
      caCertificate: "unused",
      method: "GET",
      origin: "https://api.example.test",
      path: "/v1/items",
      proxyUrl: `http://scoped-token:vault@127.0.0.1:${address.port}`,
    }),
    (error: Error) => {
      assert.equal(error.message, "Approved proxy tunnel was refused.");
      assert.equal(error.message.includes("scoped-token"), false);
      return true;
    }
  );
  assert.match(requestText, /^CONNECT api\.example\.test:443 HTTP\/1\.1/mu);
  assert.match(
    requestText,
    /^Proxy-Authorization: Basic c2NvcGVkLXRva2VuOnZhdWx0\r$/mu
  );
});

test("authenticated request rejects oversized bodies before opening the proxy", async () => {
  await assert.rejects(
    requestThroughAgentProxy({
      body: "x".repeat(256 * 1024 + 1),
      caCertificate: "unused",
      method: "POST",
      origin: "https://api.example.test",
      path: "/v1/items",
      proxyUrl: "http://token:vault@127.0.0.1:1",
    }),
    /Request body exceeds 256 KiB/u
  );
});

// The real launcher owns child environment delivery and cleanup; coordinator tests do not start the CLI.
// A synthetic desktop transport supplies the public session contract, without implementing launcher behavior.
test("agent CLI replaces the selected credential and revokes its session and certificate on exit", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-agent-cli-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  let created: Record<string, unknown> | undefined;
  let revoked = false;
  const server = http.createServer(async (request, response) => {
    assert.equal(
      request.headers.authorization,
      "Bearer synthetic-desktop-token"
    );
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
    }
    const payload = JSON.parse(body) as {
      action: string;
      data: Record<string, unknown>;
    };
    let data: MockDesktopResponseData = {};
    if (payload.action === "status") {
      data = { environmentProtocolVersion: 1, isUnlocked: true };
    } else if (payload.action === "createAgentSession") {
      created = payload.data;
      data = {
        caCertificate: rootCertificates[0],
        environmentName: "dev",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        key: "API_KEY",
        placeholder: "KEYHARBOR_SECRET",
        projectName: "demo",
        proxyUrl: "http://synthetic-proxy-token:vault@127.0.0.1:1",
        sessionId: "synthetic-session",
      };
    } else if (payload.action === "closeAgentSession") {
      assert.equal(payload.data.sessionId, "synthetic-session");
      revoked = true;
    } else {
      assert.fail(`Unexpected desktop action: ${payload.action}`);
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data, success: true }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  fs.mkdirSync(path.join(directory, ".keyharbor"));
  fs.writeFileSync(
    path.join(directory, ".keyharbor", "server-info.json"),
    JSON.stringify({
      authToken: "synthetic-desktop-token",
      host: "127.0.0.1",
      pid: process.pid,
      port: address.port,
    })
  );
  const command = `process.stdout.write(JSON.stringify({
    credential: process.env.API_KEY,
    caPath: process.env.NODE_EXTRA_CA_CERTS,
    inheritedDesktopToken: process.env.KEYHARBOR_AUTH_TOKEN,
    proxyConfigured: process.env.HTTPS_PROXY === process.env.HTTP_PROXY,
    noProxy: process.env.NO_PROXY
  }));`;
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../cli/keyharbor.js", import.meta.url)),
      "agent",
      "--project=demo",
      "--key=API_KEY",
      "--env=dev",
      "--origin=https://api.example.test",
      "--auth-header=X-Api-Key",
      "--auth-prefix=",
      "--",
      process.execPath,
      "-e",
      command,
    ],
    {
      env: {
        ...process.env,
        API_KEY: "synthetic-parent-credential",
        HOME: directory,
        KEYHARBOR_AUTH_TOKEN: "synthetic-general-token",
        NO_PROXY: "*",
        USERPROFILE: directory,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  t.after(() => child.kill());
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  const output = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(output.credential, "KEYHARBOR_SECRET");
  assert.equal(output.proxyConfigured, true);
  assert.equal(output.inheritedDesktopToken, undefined);
  assert.equal(output.noProxy, "");
  assert.equal(typeof output.caPath, "string");
  assert.equal(fs.existsSync(output.caPath as string), false);
  assert.equal(revoked, true);
  assert.equal(created?.authPrefix, "");
  assert.equal(created?.environmentName, "dev");
  assert.equal(stdout.includes("synthetic-parent-credential"), false);
  assert.equal(stdout.includes("synthetic-proxy-token"), false);
});
