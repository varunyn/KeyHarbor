const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isProcessAlive,
  validateServerInfo,
} = require("../cli/keyharbor-client");

test("validateServerInfo accepts a complete loopback configuration", () => {
  assert.equal(
    validateServerInfo({
      authToken: "token",
      host: "127.0.0.1",
      pid: process.pid,
      port: 49_152,
    }),
    true
  );
});

test("validateServerInfo rejects non-loopback and malformed configurations", () => {
  assert.equal(
    validateServerInfo({
      authToken: "token",
      host: "example.com",
      pid: process.pid,
      port: 80,
    }),
    false
  );
  assert.equal(
    validateServerInfo({
      authToken: "token",
      host: "localhost",
      pid: process.pid,
      port: 0,
    }),
    false
  );
  assert.equal(
    validateServerInfo({
      authToken: "",
      host: "localhost",
      pid: process.pid,
      port: 4000,
    }),
    false
  );
});

const restrictedProbe = () => {
  const error = new Error("Operation not permitted");
  error.code = "EPERM";
  throw error;
};

const missingProbe = () => {
  const error = new Error("No such process");
  error.code = "ESRCH";
  throw error;
};

test("isProcessAlive accepts restricted process probes", () => {
  assert.equal(isProcessAlive(123, restrictedProbe), true);
});

test("isProcessAlive rejects missing processes", () => {
  assert.equal(isProcessAlive(123, missingProbe), false);
});
