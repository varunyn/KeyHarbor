import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

// Temporary ceilings for existing oversized files. Lower these as modules are split;
// never raise a ceiling or add an exception to accommodate new code.
const existingFileLineLimits: Record<string, number> = {
  "cli/keyharbor-mcp.mts": 624,
  "cli/keyharbor.ts": 615,
  "src/dashboard/main.tsx": 3053,
  "src/main.ts": 3369,
  "src/modules/agent-proxy-coordinator.ts": 990,
  "src/modules/env-text-import-coordinator.ts": 1003,
  "src/modules/project-configuration-coordinator.ts": 987,
  "src/modules/vault-manager.ts": 1537,
  "src/modules/vault-session.js": 1202,
  "src/modules/vault.ts": 3255,
  "src/project/bridge.ts": 578,
  "src/project/components.tsx": 1824,
  "src/project/main.tsx": 3718,
  "src/renderer/reconciliation.tsx": 525,
  "src/renderer/screens.tsx": 2233,
  "test/agent-proxy.test.ts": 741,
  "test/env-text-import-coordinator.test.ts": 1159,
  "test/project-environment-core.test.ts": 779,
  "test/vault-reconciliation.test.ts": 778,
  "test/vault-session-integration.test.ts": 545,
  "test/vault-session.test.js": 704,
};

export default defineConfig({
  extends: [core, react, antiSlop],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    ...Object.entries(existingFileLineLimits).map(([file, max]) => ({
      files: [file],
      rules: { "max-lines": ["error", { max }] as const },
    })),
    {
      // These sources compile as CommonJS; TypeScript forces module scope.
      files: [
        "src/main.ts",
        "src/preload.ts",
        "src/modules/*.{js,ts}",
        "cli/keyharbor.ts",
        "scripts/sign-adhoc.js",
        "test/*.{js,ts}",
      ],
      rules: {
        "no-implicit-globals": "off",
        "unicorn/prefer-module": "off",
      },
    },
  ],
  rules: {
    // Stage the remaining rules until existing callers and boundary parsers migrate.
    // `npm run check:anti-slop` audits the full preset without these exceptions.
    "anti-slop/no-chained-type-assertions": "off",
    "anti-slop/no-conditional-empty-object-spread": "off",
    "anti-slop/no-known-value-widening": "off",
    "anti-slop/no-object-parameters": "off",
    "anti-slop/no-reflect-apply": "off",
    "anti-slop/no-runtime-typeof": "off",
    "anti-slop/no-shape-in-symbol-names": "off",
    "anti-slop/no-unknown-parameters": "off",
    "anti-slop/no-unknown-returns": "off",
    "anti-slop/no-unsafe-dictionary-type": "off",
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    "max-lines": ["error", { max: 500 }],
  },
});
