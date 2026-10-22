import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanProjectFolder } from "../src/modules/project-folder-scan";

const fixture = async (t: {
  after: (callback: () => Promise<void>) => void;
}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keyharbor-folder-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  return root;
};

test("folder scan reports real Git state and nearest-template gaps without returning values", async (t) => {
  const root = await fixture(t);
  execFileSync("git", ["init", "-q", root]);
  await fs.mkdir(path.join(root, "packages", "api"), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(root, ".gitignore"),
      ".env.local\n.env.production\n"
    ),
    fs.writeFile(
      path.join(root, ".env.example"),
      "TOKEN=template-private-value\nMISSING=\n"
    ),
    fs.writeFile(path.join(root, ".env.local"), "TOKEN=local-private-value\n"),
    fs.writeFile(
      path.join(root, ".env.production"),
      "TOKEN=prod-private-value\nMISSING=ready\n"
    ),
    fs.writeFile(
      path.join(root, "packages", "api", ".env"),
      "TOKEN=api-private-value\n"
    ),
    fs.writeFile(
      path.join(root, "packages", "api", ".env.template"),
      "TOKEN=\nAPI_ONLY=\n"
    ),
  ]);
  execFileSync("git", ["-C", root, "add", "--force", "--", ".env.production"]);
  const { summary, contents } = await scanProjectFolder(root);
  assert.equal(JSON.stringify(summary).includes("private-value"), false);
  assert.equal(summary.files.length, 3);
  const local = summary.files.find((file) => file.path === ".env.local");
  assert.equal(local?.gitStatus, "ignored");
  assert.deepEqual(local?.missingKeys, ["MISSING"]);
  const production = summary.files.find(
    (file) => file.path === ".env.production"
  );
  assert.equal(production?.gitStatus, "tracked");
  assert.deepEqual(production?.missingKeys, []);
  const api = summary.files.find((file) => file.path === "packages/api/.env");
  assert.equal(api?.gitStatus, "unignored");
  assert.equal(api?.templatePath, "packages/api/.env.template");
  assert.deepEqual(api?.missingKeys, ["API_ONLY"]);
  assert.equal(contents.get(local?.id || ""), "TOKEN=local-private-value\n");
});

test("folder scan skips dependency directories, symlinks, oversized and invalid UTF-8 files", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "node_modules"));
  await Promise.all([
    fs.writeFile(path.join(root, "node_modules", ".env"), "HIDDEN=value"),
    fs.writeFile(path.join(root, ".env.good"), "TOKEN=safe-fixture"),
    fs.writeFile(path.join(root, ".env.bad"), "not an assignment"),
    fs.writeFile(path.join(root, ".env.huge"), Buffer.alloc(1024 * 1024 + 1)),
    fs.writeFile(path.join(root, ".env.binary"), Buffer.from([0xff, 0xfe])),
    fs.writeFile(path.join(root, ".env.example"), "not a valid template"),
  ]);
  if (process.platform !== "win32") {
    await fs.symlink(
      path.join(root, ".env.good"),
      path.join(root, ".env.link")
    );
    await fs.symlink(
      path.join(root, "node_modules"),
      path.join(root, "linked-directory")
    );
  }
  const { summary, contents } = await scanProjectFolder(root);
  assert.deepEqual(
    summary.files.map((file) => file.path),
    [".env.bad", ".env.good"]
  );
  assert.equal(summary.files[0]?.valid, false);
  assert.equal(contents.size, 1);
  assert.ok(summary.warnings.some((warning) => warning.path === ".env.huge"));
  assert.ok(summary.warnings.some((warning) => warning.path === ".env.binary"));
  assert.ok(
    summary.warnings.some((warning) => warning.code === "invalidTemplate")
  );
  assert.equal(summary.files[1]?.gitStatus, "unknown");
});

test("folder scan marks partial discovery at the file budget", async (t) => {
  const root = await fixture(t);
  await Promise.all(
    Array.from({ length: 65 }, (_, index) =>
      fs.writeFile(path.join(root, `.env.fixture${index}`), "TOKEN=test-value")
    )
  );
  const { summary } = await scanProjectFolder(root);
  assert.equal(summary.limited, true);
  assert.equal(summary.files.length, 64);
});
