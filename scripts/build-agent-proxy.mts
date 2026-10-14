import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "native", "agent-proxy");
const platforms = new Map([
  ["darwin", "darwin"],
  ["linux", "linux"],
  ["win32", "windows"],
]);
const architectures = new Map([
  ["arm64", "arm64"],
  ["x64", "amd64"],
]);
const args = process.argv.slice(2);
const platform =
  args.find((arg) => arg.startsWith("--platform="))?.slice(11) ??
  process.platform;
const selectedPlatforms = args.includes("--all")
  ? [...platforms.keys()]
  : [platform];
const selectedArchitectures =
  args.includes("--all") || args.includes("--all-arch")
    ? [...architectures.keys()]
    : [process.arch];

for (const targetPlatform of selectedPlatforms) {
  for (const targetArch of selectedArchitectures) {
    const goos = platforms.get(targetPlatform);
    const goarch = architectures.get(targetArch);
    if (!goos || !goarch) {
      throw new Error(
        `Unsupported agent proxy target: ${targetPlatform}-${targetArch}`
      );
    }
    const directory = path.join(
      source,
      "bin",
      `${targetPlatform}-${targetArch}`
    );
    const name = `keyharbor-agent-proxy${targetPlatform === "win32" ? ".exe" : ""}`;
    fs.mkdirSync(directory, { recursive: true });
    const binary = path.join(directory, name);
    const result = spawnSync(
      process.env.KEYHARBOR_GO_BINARY || "go",
      [
        "build",
        "-trimpath",
        "-buildvcs=false",
        "-ldflags=-s -w",
        "-o",
        binary,
        ".",
      ],
      {
        cwd: source,
        env: {
          ...process.env,
          CGO_ENABLED: "0",
          GOARCH: goarch,
          GOOS: goos,
          GOTELEMETRY: "off",
          GOTOOLCHAIN: "local",
        },
        shell: false,
        stdio: "inherit",
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        "Agent proxy build failed. Install Go 1.25+ or set KEYHARBOR_GO_BINARY to its executable."
      );
    }
    if (targetPlatform !== "win32") {
      fs.chmodSync(binary, 0o755);
    }
    fs.copyFileSync(
      path.join(source, "UPSTREAM-LICENSE"),
      path.join(directory, "UPSTREAM-LICENSE")
    );
    fs.copyFileSync(
      path.join(source, "UPSTREAM-PROVENANCE.md"),
      path.join(directory, "UPSTREAM-PROVENANCE.md")
    );
    const manifest = {
      architecture: targetArch,
      binary: name,
      buildSha256: createHash("sha256")
        .update(fs.readFileSync(binary))
        .digest("hex"),
      hashStage: "before-platform-signing",
      platform: targetPlatform,
      upstreamCommit: "872578e4cdf9e03d5e3bcb5512023a70bf90ed65",
    };
    fs.writeFileSync(
      path.join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    process.stdout.write(
      `Built agent proxy for ${targetPlatform}-${targetArch}\n`
    );
  }
}
