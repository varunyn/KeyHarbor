import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const outputRoot = path.resolve(import.meta.dirname, "..");

for (const relativePath of [
  "package.json",
  "src/assets",
  "src/locales",
  "src/renderer-build",
]) {
  const source = path.join(projectRoot, relativePath);
  const destination = path.join(outputRoot, relativePath);
  fs.rmSync(destination, { force: true, recursive: true });
  if (!fs.existsSync(source)) {
    if (
      relativePath === "src/renderer-build" &&
      process.argv.includes("--require-renderer")
    ) {
      throw new Error("Build the renderer before creating the desktop backend");
    }
    if (relativePath !== "package.json") {
      continue;
    }
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(source)) {
    fs.cpSync(source, destination, { force: true, recursive: true });
  }
}
