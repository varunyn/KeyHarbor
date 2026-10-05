const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const cli = require("../cli/keyharbor");

/**
 * Runs the real compiled client in a child process with a synthetic HOME so the
 * server-info path resolves to the fixture. A child process is required because
 * the client resolves that path once at module load. The child is asynchronous
 * so this process can still serve the fixture transport.
 */
interface ClientOutcome {
  rejected: string | null;
  omitted: { success: boolean; data?: { value?: string } };
}

const runClientAgainstFixture = (
  clientModulePath: string,
  port: number
): Promise<ClientOutcome> => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-legacy-server-home-")
  );
  fs.mkdirSync(path.join(directory, ".localkeys"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, ".localkeys", "server-info.json"),
    JSON.stringify({
      authToken: "synthetic-auth-only",
      host: "127.0.0.1",
      pid: process.pid,
      port,
    })
  );
  const script = `
        const client = require(${JSON.stringify(clientModulePath)});
        (async () => {
            let rejected = null;
            try {
                await client.sendRequest("getSecret", { projectName: "application", key: "TOKEN", environmentName: "dev" });
            } catch (error) {
                rejected = error.message;
            }
            const omitted = await client.sendRequest("getSecret", { projectName: "application", key: "TOKEN" });
            process.stdout.write(JSON.stringify({ rejected, omitted }));
        })().catch((error) => {
            process.stderr.write(String(error && error.stack));
            process.exit(1);
        });
    `;
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  return new Promise<ClientOutcome>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      env: { ...process.env, HOME: directory, USERPROFILE: directory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      fs.rmSync(directory, { force: true, recursive: true });
      assert.equal(code, 0, stderr);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Client output was not JSON: ${stdout} ${stderr}`));
      }
    });
  });
};

test("KeyHarbor flags are parsed before the child separator only", () => {
  const parsed = cli.parseArguments([
    "--vault=Work",
    "--env=dev",
    "run",
    "--project=myapp",
    "--",
    "npm",
    "start",
  ]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.vaultName, "Work");
  assert.equal(parsed.environmentName, "dev");
  assert.deepEqual(parsed.args, [
    "run",
    "--project=myapp",
    "--",
    "npm",
    "start",
  ]);
  assert.deepEqual(parsed.childArgs, ["npm", "start"]);
});

test("child arguments after the separator are preserved untouched", () => {
  const parsed = cli.parseArguments([
    "run",
    "--project=myapp",
    "--",
    "node",
    "server.js",
    "--env=staging",
    "--vault=Fake",
    "--",
    "npm",
  ]);
  assert.equal(parsed.error, null);
  assert.equal(
    parsed.vaultName,
    null,
    "a flag after the separator belongs to the child"
  );
  assert.equal(
    parsed.environmentName,
    null,
    "a flag after the separator belongs to the child"
  );
  assert.deepEqual(parsed.childArgs, [
    "node",
    "server.js",
    "--env=staging",
    "--vault=Fake",
    "--",
    "npm",
  ]);
});

test("a command without a separator keeps every argument as a KeyHarbor argument", () => {
  const parsed = cli.parseArguments(["get", "myapp", "API_KEY", "--env=prod"]);
  assert.equal(parsed.separatorIndex, -1);
  assert.deepEqual(parsed.childArgs, []);
  assert.deepEqual(parsed.args, ["get", "myapp", "API_KEY"]);
  assert.equal(parsed.environmentName, "prod");
});

test("omitted selectors stay omitted rather than becoming a default name", () => {
  const parsed = cli.parseArguments(["get", "myapp", "API_KEY"]);
  assert.equal(parsed.vaultName, null);
  assert.equal(parsed.environmentName, null);
});

test("a malformed Environment selector fails instead of degrading to the default", () => {
  for (const argv of [
    ["--env=", "get", "a", "b"],
    ["--env=Production", "get", "a", "b"],
    ["--env=9dev", "get", "a", "b"],
    ["--env", "dev", "get", "a", "b"],
  ]) {
    const parsed = cli.parseArguments(argv);
    assert.ok(parsed.error, `expected an error for ${JSON.stringify(argv)}`);
    assert.equal(
      parsed.environmentName,
      null,
      "a malformed selector must not resolve to the default"
    );
  }
});

test("a malformed Vault selector fails instead of degrading to System", () => {
  for (const argv of [
    ["--vault=", "list"],
    ["--vault", "Work", "list"],
    ["--vault=a", "--vault=b", "list"],
  ]) {
    const parsed = cli.parseArguments(argv);
    assert.ok(parsed.error, `expected an error for ${JSON.stringify(argv)}`);
    assert.equal(parsed.vaultName, null);
  }
});

test("duplicate explicit selectors are rejected rather than silently picking one", () => {
  const parsed = cli.parseArguments([
    "--env=dev",
    "--env=prod",
    "get",
    "a",
    "b",
  ]);
  assert.ok(parsed.error);
});

test("an actual incompatible desktop server never receives the sensitive explicit request", async () => {
  const received: string[] = [];
  // A genuinely older dispatcher: it does not advertise Environment support and
  // ignores unknown selector fields, answering from the legacy collection.
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      received.push(payload.action);
      response.writeHead(200, { "Content-Type": "application/json" });
      const data =
        payload.action === "status"
          ? { isUnlocked: true, version: "1.6.0" }
          : { value: "synthetic-legacy-default" };
      response.end(JSON.stringify({ data, success: true }));
    });
  });

  try {
    // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const clientModulePath = require.resolve("../cli/keyharbor-client");
    const outcome = await runClientAgainstFixture(
      clientModulePath,
      server.address().port
    );

    assert.match(outcome.rejected, /environment|upgrade|support/iu);
    assert.equal(
      received.includes("getSecret"),
      true,
      "the omitted-selector request below is the only one sent"
    );

    // Legacy omission remains compatible with the fixed default behavior.
    assert.equal(outcome.omitted.success, true);
    assert.equal(outcome.omitted.data?.value, "synthetic-legacy-default");
    assert.equal(
      received.filter((action) => action === "getSecret").length,
      1,
      "the explicit request was rejected before it was sent"
    );
  } finally {
    // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});
