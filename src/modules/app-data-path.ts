import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Reuse existing vault data without moving encrypted files or recovery copies. */
export const getAppDataPath = (homeDirectory = os.homedir()): string => {
  const legacyDirectory = path.join(homeDirectory, ".localkeys");
  if (fs.existsSync(legacyDirectory)) {
    return legacyDirectory;
  }
  return path.join(homeDirectory, ".keyharbor");
};
