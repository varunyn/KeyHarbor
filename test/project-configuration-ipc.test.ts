import type { TestContext } from "node:test";

import type VaultSessionType from "../src/modules/vault-session";

interface ConfigurationEvaluation {
  entries: { key: string; status: string }[];
}
type IpcHandler = (
  event: unknown,
  ...args: unknown[]
) => Promise<Record<string, unknown>>;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");
const ProjectConfigurationCoordinator = require("../src/modules/project-configuration-coordinator");
const registerProjectConfigurationIpc = require("../src/modules/project-configuration-ipc");

const targetCache = new WeakMap<
  object,
  Map<string, { projectName: string; environmentId: string }>
>();

const defaultTarget = (
  vault: {
    resolveEnvironmentTarget: (selector: { projectName: string }) => {
      projectName: string;
      environmentId: string;
    };
  },
  projectName: string
) => {
  let projects = targetCache.get(vault);
  if (!projects) {
    projects = new Map();
    targetCache.set(vault, projects);
  }
  let target = projects.get(projectName);
  if (!target) {
    target = vault.resolveEnvironmentTarget({ projectName });
    projects.set(projectName, target);
  }
  return target;
};

const PASSWORD = "configuration-ipc-integration-password";

interface PickerResult {
  canceled: boolean;
  filePaths: string[];
}
type DuringPicker = (session: VaultSessionType) => Promise<void>;

const setup = async (
  t: TestContext,
  pickerResult?: PickerResult,
  duringPicker: DuringPicker = async () => {}
) => {
  const selectedPickerResult = pickerResult ?? {
    canceled: true,
    filePaths: [],
  };
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-configuration-ipc-")
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
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });

  /** @type {{ projectName: string; environmentId: string }} */
  let defaultEnvironmentTarget;
  /** @type {{ projectName: string; environmentId: string }} */
  let devTarget;
  await session.withActiveSession(async ({ activeVault }) => {
    activeVault.createProject("service");
    activeVault.createEnvironment("service", "dev");
    defaultEnvironmentTarget = activeVault.resolveEnvironmentTarget({
      projectName: "service",
    });
    devTarget = activeVault.resolveEnvironmentTarget({
      environmentName: "dev",
      projectName: "service",
    });
    activeVault.setSecret(
      defaultEnvironmentTarget,
      "READY",
      "synthetic-secret"
    );
    activeVault.setSecret(devTarget, "READY", "synthetic-dev-secret");
    activeVault.setSecret(devTarget, "DEV_ONLY", "synthetic-dev-only");
    await activeVault.replaceProjectConfigurationBaseline(
      defaultEnvironmentTarget,
      ["READY"]
    );
    await activeVault.replaceProjectConfigurationBaseline(devTarget, ["READY"]);
  });

  const coordinator = new ProjectConfigurationCoordinator({
    now: () => new Date("2030-01-01T00:00:00.000Z"),
    session,
  });
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  // oxlint-disable-next-line unicorn/prefer-event-target -- Electron lifecycle mocks use the EventEmitter interface, not the DOM event interface.
  const contents = Object.assign(new EventEmitter(), { id: 41 });
  // oxlint-disable-next-line unicorn/prefer-event-target -- Electron lifecycle mocks use the EventEmitter interface, not the DOM event interface.
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: contents,
  });
  const events: string[] = [];
  const dialog = {
    showOpenDialog: async () => {
      events.push("picker");
      await session.withActiveSession(() => {
        events.push("session-available-during-picker");
      });
      await duringPicker(session);
      return selectedPickerResult;
    },
  };
  const logger = {
    logApp: (message: string) => {
      events.push(message);
    },
  };
  registerProjectConfigurationIpc({
    coordinator,
    dialog,
    getWindow: () => window,
    ipcMain,
    logger,
  });
  const event = { sender: { id: contents.id } };
  t.after(async () => {
    await session.close({ reason: "manual" });
  });
  return {
    contents,
    coordinator,
    defaultTarget: defaultEnvironmentTarget,
    devTarget,
    directory,
    event,
    events,
    handler: (name: string): IpcHandler => {
      const registered = handlers.get(name);
      if (!registered) {
        throw new Error(`IPC handler ${name} must be registered`);
      }
      return registered;
    },
    session,
    window,
  };
};

test("configuration IPC rejects renderer paths and selects files outside the session lease", async (t) => {
  const filePath = path.join(
    os.tmpdir(),
    `keyharbor-configuration-${process.pid}.env`
  );
  fs.writeFileSync(filePath, "READY=template-value\nNEW_KEY=sample\n", "utf-8");
  t.after(() => fs.unlinkSync(filePath, { force: true }));
  const h = await setup(t, { canceled: false, filePaths: [filePath] });
  const preview = h.handler("projects:configurationPreview");
  const forbidden = await preview(h.event, h.defaultTarget, {
    filePath,
    source: "file",
  });
  assert.equal(forbidden.success, false);
  assert.equal(h.events.includes("picker"), false);

  const selected = await preview(h.event, h.defaultTarget, { source: "file" });
  assert.equal(selected.success, true);
  assert.deepEqual(selected.changes, {
    added: ["NEW_KEY"],
    removed: [],
    unchanged: ["READY"],
  });
  assert.equal(JSON.stringify(selected).includes("template-value"), false);
  assert.equal(JSON.stringify(selected).includes(filePath), false);
  assert.equal(h.events.includes("session-available-during-picker"), true);
  assert.deepEqual(await h.coordinator.commit(selected.handle), {
    addedCount: 1,
    changed: true,
    kind: "replace",
    removedCount: 0,
    requiredCount: 2,
    success: true,
    unchangedCount: 1,
  });
  const awaitedResult1 = await h.coordinator.get(h.defaultTarget);
  assert.deepEqual((awaitedResult1 as ConfigurationEvaluation).entries, [
    { key: "NEW_KEY", status: "Missing" },
    { key: "READY", status: "Ready" },
  ]);
});

test("configuration IPC requires an explicit Project and Environment target", async (t) => {
  const h = await setup(t);
  const preview = h.handler("projects:configurationPreview");
  const get = h.handler("projects:configurationGet");

  // A bare Project string is never a valid desktop target.
  const awaitedResult2 = await preview(h.event, "service", {
    content: "NEW_KEY=v\n",
    source: "text",
  });
  assert.equal(awaitedResult2.success, false);
  const awaitedResult3 = await get(h.event, "service");
  assert.equal(awaitedResult3.success, false);
  // Nor is a conflicting target that also carries an Environment name.
  const awaitedResult4 = await get(h.event, {
    ...h.defaultTarget,
    environmentName: "dev",
  });
  assert.equal(awaitedResult4.success, false);
  const awaitedResult5 = await get(h.event, {
    environmentId: "",
    projectName: "service",
  });
  assert.equal(awaitedResult5.success, false);

  const awaitedResult6 = await get(h.event, h.defaultTarget);
  assert.equal(awaitedResult6.success, true);
});

test("requirements and review handles are scoped to one Environment", async (t) => {
  const h = await setup(t);
  const preview = await h.coordinator.preview(h.devTarget, {
    content: "DEV_ONLY=t\nREADY=v\n",
    source: "text",
  });
  assert.equal(preview.success, true);
  assert.deepEqual(preview.target.environmentName, "dev");
  assert.deepEqual(preview.target.environmentId, h.devTarget.environmentId);
  assert.deepEqual(preview.changes, {
    added: ["DEV_ONLY"],
    removed: [],
    unchanged: ["READY"],
  });

  const committed = await h.coordinator.commit(preview.handle);
  assert.equal(committed.success, true, JSON.stringify(committed));

  const dev = (await h.coordinator.get(h.devTarget)) as ConfigurationEvaluation;
  const fallback = (await h.coordinator.get(
    h.defaultTarget
  )) as ConfigurationEvaluation;
  assert.deepEqual(
    dev.entries.map((entry) => entry.key),
    ["DEV_ONLY", "READY"]
  );
  assert.deepEqual(
    fallback.entries.map((entry) => entry.key),
    ["READY"]
  );
  assert.equal(fallback.entries[0].key, "READY");
});

test("a review bound to one Environment is stale after that Environment is renamed", async (t) => {
  const h = await setup(t);
  const preview = await h.coordinator.preview(h.devTarget, {
    content: "DEV_ONLY=t\n",
    source: "text",
  });
  assert.equal(preview.success, true);

  await h.session.withActiveSession(({ activeVault }) =>
    activeVault.renameEnvironment(
      "service",
      h.devTarget.environmentId,
      "development"
    )
  );
  const committed = await h.coordinator.commit(preview.handle);
  assert.equal(committed.success, false, JSON.stringify(committed));
  assert.equal(committed.code, "CONFIGURATION_STALE");

  const unchanged = (await h.coordinator.get(
    h.defaultTarget
  )) as ConfigurationEvaluation;
  assert.deepEqual(
    unchanged.entries.map((entry: { key: string }) => entry.key),
    ["READY"]
  );
});

test("a relevant Secret change in the selected Environment stales its review", async (t) => {
  const h = await setup(t);
  const preview = await h.coordinator.preview(h.devTarget, {
    content: "READY=v\n",
    source: "text",
  });
  assert.equal(preview.success, true);

  await h.session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(h.devTarget, "READY", "changed-mid-review")
  );
  const committed = await h.coordinator.commit(preview.handle);
  assert.equal(committed.success, false, JSON.stringify(committed));
  assert.equal(committed.code, "CONFIGURATION_STALE");
});

test("a Secret change in a different Environment leaves the review valid", async (t) => {
  const h = await setup(t);
  const preview = await h.coordinator.preview(h.devTarget, {
    content: "READY=v\n",
    source: "text",
  });
  assert.equal(preview.success, true);

  await h.session.withActiveSession(({ activeVault }) =>
    activeVault.setSecret(h.defaultTarget, "READY", "unrelated-change")
  );
  const committed = await h.coordinator.commit(preview.handle);
  assert.equal(committed.success, true, JSON.stringify(committed));
});

test("canceling native file selection leaves the configured baseline unchanged", async (t) => {
  const h = await setup(t);
  const result = await h.handler("projects:configurationPreview")(
    h.event,
    h.defaultTarget,
    { source: "file" }
  );
  assert.deepEqual(result, { cancelled: true, success: false });
  const awaitedResult7 = await h.coordinator.get(h.defaultTarget);
  assert.deepEqual((awaitedResult7 as ConfigurationEvaluation).entries, [
    { key: "READY", status: "Ready" },
  ]);
});

test("file preview rejects a baseline changed while native selection is open", async (t) => {
  const filePath = path.join(
    os.tmpdir(),
    `keyharbor-configuration-stale-${process.pid}.env`
  );
  fs.writeFileSync(filePath, "FROM_FILE=value\n", "utf-8");
  t.after(() => fs.unlinkSync(filePath, { force: true }));
  const h = await setup(
    t,
    { canceled: false, filePaths: [filePath] },
    async (session) => {
      await session.withActiveSession(({ activeVault }) =>
        activeVault.replaceProjectConfigurationBaseline(
          defaultTarget(activeVault, "service"),
          ["REVISED"]
        )
      );
    }
  );
  const result = await h.handler("projects:configurationPreview")(
    h.event,
    h.defaultTarget,
    { source: "file" }
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "CONFIGURATION_STALE");
  const awaitedResult8 = await h.coordinator.get(h.defaultTarget);
  assert.deepEqual((awaitedResult8 as ConfigurationEvaluation).entries, [
    { key: "REVISED", status: "Missing" },
  ]);
});

test("navigation retires an outstanding configuration review", async (t) => {
  const h = await setup(t);
  const preview = await h.handler("projects:configurationPreview")(
    h.event,
    h.defaultTarget,
    {
      content: "NEW_KEY=template-value\n",
      source: "text",
    }
  );
  assert.equal(preview.success, true);
  h.contents.emit(
    "did-start-navigation",
    {},
    "file:///other.html",
    false,
    true
  );
  const committed = await h.handler("projects:configurationCommit")(
    h.event,
    preview.handle
  );
  assert.equal(committed.success, false);
  const awaitedResult9 = await h.coordinator.get(h.defaultTarget);
  assert.deepEqual((awaitedResult9 as ConfigurationEvaluation).entries, [
    { key: "READY", status: "Ready" },
  ]);
});
