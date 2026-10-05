const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports.default = (context) => {
  if (context.electronPlatformName === "darwin") {
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`
    );
    console.log(`Ad-hoc signing: ${appPath}`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  }
};
