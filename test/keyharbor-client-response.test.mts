import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const clientPath = path.resolve(
  import.meta.dirname,
  "../cli/keyharbor-client.js"
);
const unicodeValue = "synthetic-🧪-こんにちは";
const childScript = `
const client = require(process.argv[1]);
client.sendRequest("getSecret", { mode: process.argv[2] }).then(
  response => process.stdout.write(JSON.stringify({ response })),
  error => process.stdout.write(JSON.stringify({ error: error.message }))
);
`;

const createFixture = async (t: TestContext) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-response-fixture-")
  );
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    const payload: { data: { mode: string } } = JSON.parse(body);
    if (payload.data.mode === "unicode") {
      const bytes = Buffer.from(
        JSON.stringify({ data: { value: unicodeValue }, success: true })
      );
      const split = bytes.indexOf(Buffer.from("🧪")) + 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(bytes.subarray(0, split));
      await setTimeout(25);
      response.end(bytes.subarray(split));
      return;
    }
    if (payload.data.mode === "malformed") {
      response.end("[]");
      return;
    }
    if (payload.data.mode === "broken") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"success":true,"data":');
      await setTimeout(25);
      response.destroy();
      return;
    }
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ error: "Synthetic permission denied", success: false })
    );
  });
  t.after(async () => {
    server.close();
    await once(server, "close");
    fs.rmSync(directory, { force: true, recursive: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  fs.mkdirSync(path.join(directory, ".localkeys"));
  fs.writeFileSync(
    path.join(directory, ".localkeys", "server-info.json"),
    JSON.stringify({
      authToken: "synthetic-auth-only",
      host: "127.0.0.1",
      pid: process.pid,
      port: address.port,
    })
  );
  return async (
    mode: string
  ): Promise<{
    error?: string;
    response?: { data?: { value?: string }; success: boolean };
  }> => {
    const result = await execute(
      process.execPath,
      ["-e", childScript, clientPath, mode],
      {
        env: { ...process.env, HOME: directory, USERPROFILE: directory },
        timeout: 5000,
      }
    );
    return JSON.parse(result.stdout);
  };
};

test("client preserves Unicode Secret values across real HTTP chunk boundaries", async (t) => {
  const request = await createFixture(t);
  const result = await request("unicode");
  assert.equal(result.error, undefined);
  assert.equal(result.response?.success, true);
  assert.equal(result.response?.data?.value, unicodeValue);
});

test("client rejects malformed and interrupted responses while preserving HTTP errors", async (t) => {
  const request = await createFixture(t);
  const [malformed, broken, forbidden] = await Promise.all([
    request("malformed"),
    request("broken"),
    request("forbidden"),
  ]);
  assert.match(malformed.error ?? "", /Invalid response from KeyHarbor/u);
  assert.match(broken.error ?? "", /Could not read KeyHarbor response/u);
  assert.equal(forbidden.error, "Synthetic permission denied");
});
