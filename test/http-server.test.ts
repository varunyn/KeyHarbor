import type HttpServerTypes = require("../src/modules/http-server");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { version: APP_VERSION } = require("../package.json");
const HttpServer = require("../src/modules/http-server");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");

interface ActionResult<Data = unknown> {
  success: boolean;
  data: Data;
  error?: string;
  code?: string;
}

const sortedValues = <Value>(values: Value[]): Value[] => {
  values.sort();
  return values;
};

const PASSWORD = "http-admission-integration-password";

/** Real temporary encrypted Vault plus a real VaultSession, driven only through the public HTTP dispatcher. */
const setup = async (t: { after: (fn: () => unknown) => void }) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-http-admission-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const recoveryStore = new VaultRecoveryStore(
    path.join(directory, "recovery")
  );
  const vaultManager = new VaultManager(directory, { recoveryStore });
  vaultManager.init();
  const session = new VaultSession({
    httpIngress: { disableSensitive() {}, enableSensitive() {} },
    logger: { clearEncryptionKey() {}, setEncryptionKey() {} },
    recoveryStore,
    settingsProvider: () => ({ autoLockEnabled: false, diskSyncIntervalMs: 0 }),
    vaultManager,
  });
  t.after(async () => {
    await session.close({ reason: "manual" }).catch(() => {});
  });
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  const vault = vaultManager.systemVault;
  vault.createProject("application");
  const defaultTarget = vault.resolveEnvironmentTarget({
    projectName: "application",
  });
  const dev = vault.createEnvironment("application", "dev");
  const prod = vault.createEnvironment("application", "prod");
  const devTarget = { environmentId: dev.id, projectName: "application" };
  const prodTarget = { environmentId: prod.id, projectName: "application" };
  vault.setSecret(defaultTarget, "TOKEN", "synthetic-default");
  vault.setSecret(devTarget, "TOKEN", "synthetic-dev");
  vault.setSecret(prodTarget, "TOKEN", "synthetic-prod");
  await vault.saveNow();

  const server = new HttpServer(vaultManager, null, session);
  t.after(() => server.stop().catch?.(() => {}) ?? Promise.resolve());

  return {
    defaultTarget,
    dev,
    devTarget,
    directory,
    prod,
    prodTarget,
    server,
    session,
    vault,
    vaultManager,
  };
};

test("status advertises the Environment protocol version and derives unlocked state from the session", async (t) => {
  const { server } = await setup(t);
  const response = await server.handleAction("status", {});
  assert.deepEqual(response, {
    data: {
      environmentProtocolVersion: 1,
      isUnlocked: true,
      version: APP_VERSION,
    },
    success: true,
  });
});

test("sensitive actions require an active session without looking up a vault", async (t) => {
  const { server, session } = await setup(t);
  await session.close({ reason: "manual" });

  assert.deepEqual(
    await server.handleAction("createProject", { projectName: "demo" }),
    {
      code: "VAULT_SESSION_LOCKED",
      error: "Vault is locked",
      success: false,
    }
  );
});

test("explicit Environment selectors resolve independently and omission targets the Project default", async (t) => {
  const { server } = await setup(t);
  const approvals: HttpServerTypes.ApprovalRequest[] = [];
  server.setApprovalCallback(
    // oxlint-disable-next-line eslint/require-await -- Approval mocks preserve asynchronous promise rejection behavior.
    async (request: HttpServerTypes.ApprovalRequest) => {
      approvals.push(request);
      return { approved: true };
    }
  );

  for (const [environmentName, expected] of [
    ["dev", "synthetic-dev"],
    ["prod", "synthetic-prod"],
    [undefined, "synthetic-default"],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
    const response: ActionResult = await server.handleAction("getSecret", {
      key: "TOKEN",
      projectName: "application",
      ...(environmentName === undefined ? {} : { environmentName }),
    });
    assert.equal(response.success, true, JSON.stringify(response));
    assert.equal((response.data as { value: string }).value, expected);
  }

  const environments: ActionResult = await server.handleAction(
    "listEnvironments",
    {
      projectName: "application",
    }
  );
  assert.equal(environments.success, true);
  assert.deepEqual(
    sortedValues(
      (environments.data as { name: string; isDefault: boolean }[]).map(
        (entry: { name: string }) => entry.name
      )
    ),
    ["default", "dev", "prod"]
  );
  assert.equal(
    (environments.data as { name: string; isDefault: boolean }[]).find(
      (entry: { name: string }) => entry.name === "dev"
    )?.isDefault,
    false
  );
  assert.equal(
    approvals.filter((request) => request.environmentName === "dev").length,
    1
  );
  assert.equal(
    approvals.filter((request) => request.environmentName === "default").length,
    1
  );
  assert.equal(
    approvals.filter((request) => request.environmentName === "prod").length,
    1
  );
  assert.ok(approvals.every((request) => request.vaultName === "System"));
});

test("malformed, unknown, and conflicting Environment selectors are rejected before approval", async (t) => {
  const { server, dev } = await setup(t);
  let approvals = 0;
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  server.setApprovalCallback(async () => {
    approvals += 1;
    return { approved: true };
  });

  const invalidSelectors = [
    { environmentName: "missing" },
    { environmentName: "" },
    { environmentName: "   " },
    { environmentName: null },
    { environmentName: 42 },
    { environmentId: dev.id, environmentName: "dev" },
    { environmentId: dev.id },
  ];

  for (const selector of invalidSelectors) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- These operations intentionally run in order against the same mutable test session.
    const response: ActionResult = await server.handleAction("getSecret", {
      key: "TOKEN",
      projectName: "application",
      ...selector,
    });
    assert.equal(
      response.success,
      false,
      `expected rejection for ${JSON.stringify(selector)}`
    );
    assert.equal(
      response.data,
      undefined,
      `rejected selector must not disclose values: ${JSON.stringify(selector)}`
    );
  }
  assert.equal(
    approvals,
    0,
    "invalid selectors must be rejected before approval"
  );

  const missingProject: ActionResult = await server.handleAction("getSecret", {
    key: "TOKEN",
  });
  assert.equal(missingProject.success, false);
  assert.equal(approvals, 0);
});

test("getAllSecrets snapshots before approval and rejects stale state instead of releasing it", async (t) => {
  const { server, vault, devTarget, prodTarget } = await setup(t);

  const duringApproval = async (
    action: string,
    data: Record<string, unknown>,
    mutate: () => unknown
  ) => {
    let entered!: () => void;
    let approve!: (decision: { approved: boolean }) => void;
    // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
    const approval = new Promise<{ approved: boolean }>((resolve) => {
      approve = resolve;
    });
    // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
    server.setApprovalCallback(async () => {
      entered();
      return approval;
    });
    const pending = server.handleAction(action, {
      environmentName: "dev",
      projectName: "application",
      ...data,
    });
    await Promise.race([
      enteredPromise,
      // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
      new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("approval was never requested")),
          3000
        );
        timer.unref();
      }),
    ]);
    await mutate();
    approve({ approved: true });
    return pending;
  };

  const stale: ActionResult = await duringApproval("getAllSecrets", {}, () =>
    vault.setSecret(devTarget, "TOKEN", "synthetic-dev-changed")
  );
  assert.equal(stale.success, false, JSON.stringify(stale));
  assert.equal(
    stale.data,
    undefined,
    "a stale bulk read must disclose no values"
  );

  // An unrelated Environment edit is not operation-relevant and must still be served.
  const unrelated: ActionResult<{ value: string }> = await duringApproval(
    "getSecret",
    { key: "TOKEN" },
    () => vault.setSecret(prodTarget, "TOKEN", "synthetic-prod-changed")
  );
  assert.equal(unrelated.success, true, JSON.stringify(unrelated));
  assert.equal(unrelated.data.value, "synthetic-dev-changed");

  // Renaming the selected Environment retires the pending approval.
  const renamed: ActionResult = await duringApproval(
    "getSecret",
    { key: "TOKEN" },
    () =>
      vault.renameEnvironment(
        "application",
        devTarget.environmentId,
        "development"
      )
  );
  assert.equal(renamed.success, false, JSON.stringify(renamed));
  assert.equal(renamed.data, undefined);

  vault.renameEnvironment("application", devTarget.environmentId, "dev");

  // A relevant write during approval must not commit the approved value.
  const write: ActionResult = await duringApproval(
    "setBatchSecrets",
    { secrets: { TOKEN: "must-not-commit" } },
    () => vault.setSecret(devTarget, "TOKEN", "newer-value")
  );
  assert.equal(write.success, false, JSON.stringify(write));
  assert.equal(vault.getSecret(devTarget, "TOKEN").value, "newer-value");
});

test("getBatchSecrets revalidates the whole Environment and never resolves another collection", async (t) => {
  const { server, vault, devTarget } = await setup(t);
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  server.setApprovalCallback(async () => ({ approved: true }));

  const missing: ActionResult<Record<string, { value: string }>> =
    await server.handleAction("getBatchSecrets", {
      environmentName: "dev",
      keys: ["TOKEN", "ABSENT"],
      projectName: "application",
    });
  assert.equal(missing.success, true, JSON.stringify(missing));
  assert.deepEqual(Object.keys(missing.data), ["TOKEN"]);
  assert.equal(missing.data.TOKEN.value, "synthetic-dev");
  assert.equal(JSON.stringify(missing).includes("synthetic-prod"), false);

  // A relevant edit after approval is stale; the pre-approval snapshot is not released.
  let entered!: () => void;
  let approve!: (decision: { approved: boolean }) => void;
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  // oxlint-disable-next-line promise/avoid-new -- The harness exposes explicit settlement to control lifecycle and callback timing.
  const approval = new Promise<{ approved: boolean }>((resolve) => {
    approve = resolve;
  });
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  server.setApprovalCallback(async () => {
    entered();
    return approval;
  });
  const pending = server.handleAction("getBatchSecrets", {
    environmentName: "dev",
    keys: ["TOKEN"],
    projectName: "application",
  });
  await enteredPromise;
  vault.setSecret(devTarget, "TOKEN", "dev-changed-mid-approval");
  approve({ approved: true });
  const response: ActionResult = await pending;
  assert.equal(response.success, false, JSON.stringify(response));
  assert.equal(
    response.data,
    undefined,
    "a stale batch read must disclose no values"
  );
});

test("createProject is not Environment-scoped and stays idempotent without approval", async (t) => {
  const { server, vault } = await setup(t);
  const approvals: HttpServerTypes.ApprovalRequest[] = [];
  server.setApprovalCallback(
    // oxlint-disable-next-line eslint/require-await -- Approval mocks preserve asynchronous promise rejection behavior.
    async (request: HttpServerTypes.ApprovalRequest) => {
      approvals.push(request);
      return { approved: true };
    }
  );

  const existing: ActionResult = await server.handleAction("createProject", {
    projectName: "application",
  });
  assert.deepEqual(existing, { data: { created: false }, success: true });
  assert.equal(approvals.length, 0);

  const created: ActionResult = await server.handleAction("createProject", {
    environmentName: "dev",
    projectName: "other",
  });
  assert.deepEqual(created, { data: { created: true }, success: true });
  assert.ok(
    vault
      .getProjects()
      .some((entry: { name: string }) => entry.name === "other")
  );
  // The approval payload records that no Environment was selected.
  assert.equal(approvals[0].environmentId, null);
  assert.equal(approvals[0].environmentName, null);
  // A newly created Project starts with exactly one default Environment.
  assert.deepEqual(
    vault.getEnvironments("other").map((entry: { name: string }) => entry.name),
    ["default"]
  );
});

test("listSecretKeys scopes keys to the selected Environment", async (t) => {
  const { server, vault, devTarget } = await setup(t);
  vault.setSecret(devTarget, "DEV_ONLY", "synthetic");
  await vault.saveNow();
  const approvals: HttpServerTypes.ApprovalRequest[] = [];
  server.setApprovalCallback(
    // oxlint-disable-next-line eslint/require-await -- Approval mocks preserve asynchronous promise rejection behavior.
    async (request: HttpServerTypes.ApprovalRequest) => {
      approvals.push(request);
      return { approved: true };
    }
  );

  const dev: ActionResult = await server.handleAction("listSecretKeys", {
    environmentName: "dev",
    projectName: "application",
  });
  assert.equal(dev.success, true, JSON.stringify(dev));
  assert.deepEqual(sortedValues(dev.data as string[]), ["DEV_ONLY", "TOKEN"]);

  const omitted: ActionResult = await server.handleAction("listSecretKeys", {
    projectName: "application",
  });
  assert.deepEqual(omitted.data, ["TOKEN"]);
  assert.equal(approvals[1].environmentName, "default");
});

test("listEnvironments is metadata only and rejects an Environment selector", async (t) => {
  const { server } = await setup(t);
  let approvals = 0;
  // oxlint-disable-next-line eslint/require-await -- Keep this mock asynchronous so synchronous failures remain promise rejections.
  server.setApprovalCallback(async () => {
    approvals += 1;
    return { approved: true };
  });

  const listed: ActionResult = await server.handleAction("listEnvironments", {
    projectName: "application",
  });
  assert.equal(listed.success, true);
  assert.equal(JSON.stringify(listed).includes("synthetic-dev"), false);
  assert.equal(approvals, 0, "metadata discovery must not require approval");

  const rejected: ActionResult = await server.handleAction("listEnvironments", {
    environmentName: "dev",
    projectName: "application",
  });
  assert.equal(rejected.success, false);
  const missingProject: ActionResult = await server.handleAction(
    "listEnvironments",
    {}
  );
  assert.equal(missingProject.success, false);
});

test("unknown actions and non-object payloads are rejected", async (t) => {
  const { server } = await setup(t);
  assert.deepEqual(await server.handleAction("dropEverything", {}), {
    error: "Unknown action",
    success: false,
  });
  assert.deepEqual(await server.handleAction(undefined, {}), {
    error: "Unknown action",
    success: false,
  });
  const list: ActionResult = await server.handleAction("listProjects", []);
  assert.equal(list.success, true);
});
