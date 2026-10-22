import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import type { FolderScanFile, FolderScanSummary } from "../project/bridge";

const { parseEnvironmentText, MAX_INPUT_BYTES } = require("./env-text-parser");

const MAX_FILES = 64;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_DEPTH = 4;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "coverage",
  ".turbo",
]);
const TEMPLATE_SUFFIX = /\.(?:example|sample|template|dist)$/u;
const ENV_FILE = /^\.env(?:\.[a-zA-Z0-9_.-]+)?$/u;

interface ScannedFile {
  info: FolderScanFile;
  content: string;
  keys: string[];
  template: boolean;
}

/** Read only regular, bounded UTF-8 files, without following symlinks. */
const readEnvironmentFile = async (root: string, filePath: string) => {
  const before = await fs.lstat(filePath);
  if (
    !before.isFile() ||
    before.size > MAX_INPUT_BYTES ||
    (await fs.realpath(filePath)) !== filePath
  ) {
    throw new Error("UNREADABLE_FILE");
  }
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("UNREADABLE_FILE");
  }
  // Nonblocking and no-follow flags keep a swapped FIFO or symlink from being read.
  const flags =
    // eslint-disable-next-line no-bitwise
    constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW || 0);
  const file = await fs.open(filePath, flags);
  try {
    const current = await file.stat();
    if (
      !current.isFile() ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.size > MAX_INPUT_BYTES
    ) {
      throw new Error("UNREADABLE_FILE");
    }
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      // Each read advances the same bounded file offset.
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        size
      );
      if (!bytesRead) {
        break;
      }
      size += bytesRead;
    }
    if (size > MAX_INPUT_BYTES) {
      throw new Error("UNREADABLE_FILE");
    }
    return {
      bytes: buffer.subarray(0, size),
      size,
    };
  } finally {
    await file.close();
  }
};

/** Git plumbing only: no shell, hooks, writes, or filesystem-monitor commands. */
const git = (
  root: string,
  args: string[],
  input?: string
): Promise<string | null> =>
  // eslint-disable-next-line promise/avoid-new -- Adapt bounded child-process events to the async scanner.
  new Promise((resolve) => {
    const child = spawn(
      "git",
      [
        "--no-optional-locks",
        ...(args[0] === "ls-files" ? ["--literal-pathspecs"] : []),
        "-c",
        "core.fsmonitor=false",
        "-C",
        root,
        ...args,
      ],
      {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      }
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 3000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        child.kill();
        resolve(null);
      } else {
        chunks.push(chunk);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        code === 0 || code === 1
          ? Buffer.concat(chunks).toString("utf-8")
          : null
      );
    });
    child.stdin.on("error", () => {
      /* Exiting Git may close stdin before input is consumed. */
    });
    child.stdin.end(input);
  });

const gitStatuses = async (root: string, files: ScannedFile[]) => {
  const paths = files.map(({ info }) => info.path);
  if (!paths.length) {
    return;
  }
  const [ignoredOutput, trackedOutput] = await Promise.all([
    git(
      root,
      ["check-ignore", "--no-index", "-z", "--stdin"],
      `${paths.join("\0")}\0`
    ),
    git(root, ["ls-files", "-z", "--cached", "--", ...paths]),
  ]);
  if (ignoredOutput === null || trackedOutput === null) {
    return;
  }
  const ignored = new Set(ignoredOutput.split("\0"));
  const tracked = new Set(trackedOutput.split("\0"));
  for (const { info } of files) {
    if (tracked.has(info.path)) {
      info.gitStatus = "tracked";
    } else {
      info.gitStatus = ignored.has(info.path) ? "ignored" : "unignored";
    }
  }
};

const findTemplate = (
  file: ScannedFile,
  templates: Map<string, ScannedFile>
) => {
  for (const suffix of ["example", "sample", "template", "dist"]) {
    const exact = templates.get(`${file.info.path}.${suffix}`);
    if (exact) {
      return exact;
    }
  }
  let directory = path.posix.dirname(file.info.path);
  while (true) {
    for (const suffix of ["example", "sample", "template", "dist"]) {
      const template = templates.get(
        path.posix.join(directory, `.env.${suffix}`)
      );
      if (template) {
        return template;
      }
    }
    if (directory === ".") {
      return;
    }
    directory = path.posix.dirname(directory);
  }
};

const summarizeFolder = async (
  root: string,
  files: ScannedFile[],
  warnings: FolderScanSummary["warnings"],
  limited: boolean
) => {
  await gitStatuses(root, files);
  const templates = new Map(
    files.filter((file) => file.template).map((file) => [file.info.path, file])
  );
  const environmentFiles = files.filter((file) => !file.template);
  for (const file of environmentFiles) {
    const template = findTemplate(file, templates);
    if (!template) {
      continue;
    }
    file.info.templatePath = template.info.path;
    if (!template.info.valid) {
      warnings.push({ code: "invalidTemplate", path: template.info.path });
      continue;
    }
    file.info.missingKeys = template.keys.filter(
      (key) => !file.keys.includes(key)
    );
  }
  environmentFiles.sort((a, b) => a.info.path.localeCompare(b.info.path));
  const templatePaths = [...templates.keys()];
  templatePaths.sort();
  return {
    contents: new Map(
      environmentFiles
        .filter((file) => file.info.valid)
        .map((file) => [file.info.id, file.content])
    ),
    summary: {
      files: environmentFiles.map(({ info }) => info),
      folderName: path.basename(root),
      limited,
      templates: templatePaths,
      warnings,
    },
  };
};

export const scanProjectFolder = async (
  directory: string
): Promise<{
  summary: Omit<FolderScanSummary, "scanId">;
  contents: Map<string, string>;
}> => {
  const directoryStats = await fs.lstat(directory);
  if (!directoryStats.isDirectory()) {
    throw new Error("INVALID_FOLDER");
  }
  const root = await fs.realpath(directory);
  const files: ScannedFile[] = [];
  const warnings: FolderScanSummary["warnings"] = [];
  let visited = 0;
  let totalBytes = 0;
  let attemptedFiles = 0;
  let limited = false;
  const queue = [{ depth: 0, directory: root }];
  while (queue.length && !limited) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    // Walking is deliberately serial to enforce one global scan budget.
    // eslint-disable-next-line no-await-in-loop
    const canonical = await fs.realpath(next.directory).catch(() => null);
    if (canonical !== next.directory) {
      continue;
    }
    // Streaming avoids allocating an unbounded listing in a large repository.
    // eslint-disable-next-line no-await-in-loop
    const entries = await fs.opendir(next.directory).catch(() => null);
    if (!entries) {
      warnings.push({
        code: "unreadable",
        path: path.relative(root, next.directory) || ".",
      });
      continue;
    }
    // Directory iteration and reads share one global traversal budget.
    // eslint-disable-next-line no-await-in-loop
    for await (const entry of entries) {
      visited += 1;
      if (visited > MAX_ENTRIES) {
        limited = true;
        break;
      }
      const filePath = path.join(next.directory, entry.name);
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
        if (next.depth < MAX_DEPTH) {
          queue.push({ depth: next.depth + 1, directory: filePath });
        } else {
          limited = true;
        }
        continue;
      }
      if (!ENV_FILE.test(entry.name)) {
        continue;
      }
      const relative = path.relative(root, filePath).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        warnings.push({ code: "symlink", path: relative });
        continue;
      }
      if (!entry.isFile()) {
        warnings.push({ code: "unreadable", path: relative });
        continue;
      }
      if (attemptedFiles >= MAX_FILES) {
        limited = true;
        break;
      }
      attemptedFiles += 1;
      try {
        // eslint-disable-next-line no-await-in-loop -- Bound aggregate bytes before reading another file.
        const { bytes, size } = await readEnvironmentFile(root, filePath);
        totalBytes += size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          limited = true;
          break;
        }
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const parsed = parseEnvironmentText(content);
        const keys = [
          ...new Set<string>(
            parsed.assignments.map((item: { key: string }) => item.key)
          ),
        ];
        keys.sort();
        files.push({
          content,
          info: {
            gitStatus: "unknown",
            id: randomUUID(),
            keyCount: keys.length,
            missingKeys: null,
            path: relative,
            suggestedEnvironment:
              entry.name === ".env" ? null : entry.name.slice(5),
            templatePath: null,
            valid: parsed.diagnostics.length === 0,
          },
          keys,
          template: TEMPLATE_SUFFIX.test(entry.name),
        });
      } catch {
        warnings.push({ code: "unreadable", path: relative });
      }
    }
  }
  return await summarizeFolder(root, files, warnings, limited);
};
