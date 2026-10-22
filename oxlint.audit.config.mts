import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";

import config from "./oxlint.config.mts";

// Re-enable every anti-slop rule while preserving file ceilings and CJS overrides.
export default defineConfig({
  ...config,
  rules: { ...config.rules, ...antiSlop.rules },
});
