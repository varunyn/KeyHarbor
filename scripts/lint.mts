import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

const run = (script: string, args: string[]): boolean => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Failed to start ${script}: ${result.error.message}`);
    return true;
  }
  return result.status !== 0;
};

let failed = false;

failed =
  run(path.join(root, "node_modules", "ultracite", "dist", "index.js"), [
    "check",
  ]) || failed;
failed =
  run(path.join(root, "backend-build/scripts/lint-inline-js.mjs"), [root]) ||
  failed;
failed =
  run(path.join(root, "node_modules", "stylelint", "bin", "stylelint.mjs"), [
    "src/**/*.{css,html}",
  ]) || failed;

if (failed) {
  process.exitCode = 1;
}
