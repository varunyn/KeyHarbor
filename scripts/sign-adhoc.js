const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports.default = async (context) => {
  if (context.electronPlatformName === "darwin") {
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`
    );
    const { patchMachOUuids } = await import(
      pathToFileURL(
        path.join(__dirname, "../backend-build/scripts/macho-uuid.mjs")
      ).href
    );
    const resources = path.join(appPath, "Contents", "Resources");
    const appHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(resources, "app.asar")))
      .digest("hex");
    const executable = path.join(
      appPath,
      "Contents",
      "MacOS",
      context.packager.appInfo.productFilename
    );
    fs.writeFileSync(
      executable,
      patchMachOUuids(
        fs.readFileSync(executable),
        `${context.packager.appInfo.id}:${appHash}`
      )
    );
    const helper = path.join(resources, "agent-proxy", "keyharbor-agent-proxy");
    execFileSync("codesign", [
      "--force",
      "--sign",
      "-",
      "--identifier",
      `${context.packager.appInfo.id}.agent-proxy`,
      helper,
    ]);
    console.log(`Ad-hoc signing: ${appPath}`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  }
};
