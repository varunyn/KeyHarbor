const test = require("node:test");
const assert = require("node:assert/strict");
const ShutdownCoordinator = require("../src/modules/shutdown-coordinator");

const createHarness = (requestedCloseResult) => {
  const closeResult =
    requestedCloseResult === undefined
      ? { outcome: "closed", state: "locked" }
      : requestedCloseResult;
  const calls = [];
  const app = {
    exit: (code) => calls.push(["exit", code]),
    quit: () => calls.push(["quit"]),
  };
  const session = {
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    close: async (request) => {
      calls.push(["close", request]);
      return closeResult;
    },
  };
  const coordinator = new ShutdownCoordinator({
    app,
    // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
    // eslint-disable-next-line require-await
    beforeExit: async () => calls.push(["before-exit"]),
    deadlineMs: 25,
    destroyUi: () => calls.push(["destroy-ui"]),
    reportError: (error) => calls.push(["error", error.message]),
    session,
  });
  return { calls, coordinator };
};

test("quit requests share one graceful shutdown", async () => {
  const { calls, coordinator } = createHarness();

  const first = coordinator.requestQuit();
  const second = coordinator.requestQuit();

  assert.equal(first, second);
  assert.deepEqual(await first, {
    mode: "quit",
    result: { outcome: "closed", state: "locked" },
  });
  assert.deepEqual(calls, [
    ["close", { deadlineMs: 25, reason: "quit" }],
    ["before-exit"],
    ["destroy-ui"],
    ["quit"],
  ]);
});

test("before-quit is intercepted until the final exit begins", async () => {
  const { coordinator } = createHarness();
  let prevented = 0;
  const event = { preventDefault: () => (prevented += 1) };

  coordinator.handleBeforeQuit(event);
  await coordinator.requestQuit();
  coordinator.handleBeforeQuit(event);

  assert.equal(prevented, 1);
});

test("a drain timeout uses the non-intercepted hard exit", async () => {
  const { calls, coordinator } = createHarness({
    outcome: "drain_timeout",
    state: "closing",
  });

  assert.deepEqual(await coordinator.requestQuit(), { code: 1, mode: "exit" });
  assert.deepEqual(calls, [
    ["close", { deadlineMs: 25, reason: "quit" }],
    ["error", "Vault session did not drain before shutdown deadline"],
    ["destroy-ui"],
    ["exit", 1],
  ]);
});

test("a close failure reports the error and hard exits once", async () => {
  const { calls, coordinator } = createHarness();
  // Retain the asynchronous fixture contract and rejection timing used by session lifecycle tests.
  // eslint-disable-next-line require-await
  coordinator.session.close = async () => {
    calls.push(["close-failed"]);
    throw new Error("close failed");
  };

  assert.deepEqual(await coordinator.requestQuit(), { code: 1, mode: "exit" });
  assert.deepEqual(calls, [
    ["close-failed"],
    ["error", "close failed"],
    ["destroy-ui"],
    ["exit", 1],
  ]);
});
