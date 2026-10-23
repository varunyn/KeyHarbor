import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionErrorResponse } from "../src/modules/project-bridge-support";

test("sessionErrorResponse formats Error instances with and without codes", () => {
  const standardError = new Error("Standard error occurred");
  assert.deepEqual(sessionErrorResponse(standardError), {
    error: "Standard error occurred",
    success: false,
  });

  const codedError = new Error("Vault locked");
  (codedError as Error & { code: string }).code = "VAULT_LOCKED";
  assert.deepEqual(sessionErrorResponse(codedError), {
    code: "VAULT_LOCKED",
    error: "Vault locked",
    success: false,
  });
});

test("sessionErrorResponse formats objects with message/code and primitive values", () => {
  const errorObj = { code: "CUSTOM_CODE", message: "Failed operation" };
  assert.deepEqual(sessionErrorResponse(errorObj), {
    code: "CUSTOM_CODE",
    error: "Failed operation",
    success: false,
  });

  assert.deepEqual(sessionErrorResponse("plain string error"), {
    error: "plain string error",
    success: false,
  });

  assert.deepEqual(sessionErrorResponse(null), {
    error: "null",
    success: false,
  });
});
