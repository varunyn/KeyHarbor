import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [root] = process.argv.slice(2);
if (!root) {
  throw new Error("Pass the project root as the first argument");
}

const viewsDir = path.join(root, "src", "views");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "keyharbor-inline-lint-"));
const files: string[] = [];
const displayPaths = new Map<string, string>();

const remapPaths = (output: string, paths: Map<string, string>): string => {
  let remapped = output;
  for (const [tempPath, htmlPath] of paths) {
    remapped = remapped.replaceAll(tempPath, htmlPath);
  }
  return remapped;
};

try {
  const entries = await readdir(viewsDir);
  const names = entries.filter((name) => name.endsWith(".html"));
  const views = await Promise.all(
    names.map(async (name) => ({
      html: await readFile(path.join(viewsDir, name), "utf-8"),
      name,
    }))
  );
  const writes: Promise<void>[] = [];
  for (const { name, html } of views) {
    const htmlPath = path.join(viewsDir, name);
    const scriptTags =
      /<script\b(?<attributes>[^>]*)>(?<source>[\s\S]*?)<\/script\s*>/giu;
    let scriptNumber = 0;

    for (const match of html.matchAll(scriptTags)) {
      const attributes = match.groups?.attributes ?? "";
      const source = match.groups?.source ?? "";
      if (/\bsrc\s*=/u.test(attributes)) {
        continue;
      }

      const scriptStart = match.index + match[0].indexOf(">") + 1;
      const lineOffset = (html.slice(0, scriptStart).match(/\n/gu) ?? [])
        .length;
      const tempPath = path.join(
        tempDir,
        `${path.parse(name).name}.${scriptNumber}.js`
      );
      scriptNumber += 1;
      writes.push(writeFile(tempPath, `${"\n".repeat(lineOffset)}${source}`));
      files.push(tempPath);
      displayPaths.set(tempPath, htmlPath);
      displayPaths.set(path.relative(root, tempPath), htmlPath);
    }
  }

  // Wait for every write before linting or removing the temporary directory.
  const results = await Promise.allSettled(writes);
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }

  if (files.length > 0) {
    try {
      const output = execFileSync(
        process.execPath,
        [
          path.join(root, "node_modules", "oxlint", "bin", "oxlint"),
          "--config",
          path.join(root, "oxlint.config.mts"),
          ...files,
        ],
        { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
      );
      process.stdout.write(remapPaths(output, displayPaths));
    } catch (error) {
      const failure = error as {
        stdout?: Buffer;
        stderr?: Buffer;
        status?: number | null;
      };
      if (failure.stdout) {
        process.stdout.write(
          remapPaths(failure.stdout.toString(), displayPaths)
        );
      }
      if (failure.stderr) {
        process.stderr.write(
          remapPaths(failure.stderr.toString(), displayPaths)
        );
      }
      process.exitCode = failure.status ?? 1;
    }
  }
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
