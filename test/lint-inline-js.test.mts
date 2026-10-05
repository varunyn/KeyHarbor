import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../..");

// Exercise the compiled CLI and actual Oxlint, including its relative paths.
test("inline lint preserves HTML diagnostic locations and cleans temporary files", (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-lint-fixture-")
  );
  t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
  const views = path.join(fixtureRoot, "src", "views");
  const temp = path.join(fixtureRoot, "temp");
  fs.mkdirSync(views, { recursive: true });
  fs.mkdirSync(temp);
  fs.symlinkSync(
    path.join(projectRoot, "node_modules"),
    path.join(fixtureRoot, "node_modules"),
    "junction"
  );
  fs.copyFileSync(
    path.join(projectRoot, "oxlint.config.mts"),
    path.join(fixtureRoot, "oxlint.config.mts")
  );
  const htmlPath = path.join(views, "probe.html");
  const run = () =>
    spawnSync(
      process.execPath,
      [
        path.join(
          projectRoot,
          "backend-build",
          "scripts",
          "lint-inline-js.mjs"
        ),
        fixtureRoot,
      ],
      {
        encoding: "utf-8",
        env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
      }
    );

  fs.writeFileSync(
    htmlPath,
    '<html>\n<script src="external.js">const ignored = ;</script>\n<script>\nconst broken = ;\n</script>\n</html>\n'
  );
  const invalid = run();
  assert.equal(invalid.error, undefined);
  assert.notEqual(invalid.status, 0);
  const diagnostics = invalid.stdout + invalid.stderr;
  assert.ok(diagnostics.includes(`${htmlPath}:4:`), diagnostics);
  assert.doesNotMatch(diagnostics, /keyharbor-inline-lint-/u);
  assert.deepEqual(fs.readdirSync(temp), []);

  fs.writeFileSync(
    htmlPath,
    '<script src="external.js">const ignored = ;</script>\n'
  );
  const external = run();
  assert.equal(external.error, undefined);
  assert.equal(external.status, 0, external.stderr);
  assert.deepEqual(fs.readdirSync(temp), []);
});
