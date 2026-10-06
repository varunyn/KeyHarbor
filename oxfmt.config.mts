import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // External skill bundles, tool state, and Supabase CLI cache aren't app source.
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    ".agents/**",
    ".impeccable/**",
    "supabase/.temp/**",
    // Release Please generates Markdown with its own formatting conventions.
    "CHANGELOG.md",
  ],
});
