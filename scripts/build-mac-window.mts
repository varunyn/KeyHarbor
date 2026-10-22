import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const headers = require("node-api-headers") as { include_dir: string };
  const root = path.resolve(import.meta.dirname, "../..");
  const architectures = process.argv.includes("--all-arch")
    ? ["arm64", "x64"]
    : [process.arch];
  for (const architecture of architectures) {
    if (architecture !== "arm64" && architecture !== "x64") {
      throw new Error(`Unsupported macOS architecture: ${architecture}`);
    }
    const directory = path.join(
      root,
      "native/mac-window/bin",
      `darwin-${architecture}`
    );
    fs.mkdirSync(directory, { recursive: true });
    execFileSync(
      "xcrun",
      [
        "clang++",
        "-std=c++17",
        "-bundle",
        "-undefined",
        "dynamic_lookup",
        "-fobjc-arc",
        "-framework",
        "AppKit",
        "-DNAPI_VERSION=8",
        "-mmacosx-version-min=12.0",
        "-arch",
        architecture === "x64" ? "x86_64" : "arm64",
        "-I",
        headers.include_dir,
        path.join(root, "native/mac-window/window-material.mm"),
        "-o",
        path.join(directory, "window-material.node"),
      ],
      { stdio: "inherit" }
    );
    console.log(`Built macOS window material (${architecture})`);
  }
}
