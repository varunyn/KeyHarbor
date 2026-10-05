import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react],
  ignorePatterns: core.ignorePatterns,
  overrides: [
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
});
