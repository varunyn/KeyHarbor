import type { BoundaryValue } from "./env-text-import-types";
import { isRecordValue, isStringValue } from "./env-text-import-validation";
import { publicTarget, safeError } from "./project-configuration-support";
import type {
  ConfigStoredSecret,
  ConfigurationStatus,
  ReviewBinding,
  TemplateResult,
  ValidTemplateInput,
} from "./project-configuration-types";
import type {
  ReviewBaseline,
  ReviewBaselineSnapshot,
  ReviewVault,
} from "./review-contracts";

const fs = require("node:fs");
const { TextDecoder } = require("node:util");
const { parseEnvironmentText, MAX_INPUT_BYTES } = require("./env-text-parser");
const { normalizeRequiredKeys } = require("./project-configuration-baseline");

export { MAX_INPUT_BYTES };

export const evaluateSnapshot = (
  requiredKeys: string[],
  secrets: Record<string, BoundaryValue>,
  nowValue: Date
) => {
  const evaluated = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const evaluatedMs = evaluated.getTime();
  if (!Number.isFinite(evaluatedMs)) {
    throw safeError("CONFIGURATION_EVALUATION_FAILED");
  }
  const entries: { key: string; status: ConfigurationStatus }[] = [];
  const counts = {
    empty: 0,
    expired: 0,
    missing: 0,
    ready: 0,
    required: requiredKeys.length,
  };
  let nextExpiryMs = Infinity;
  for (const key of requiredKeys) {
    if (!Object.hasOwn(secrets, key) || secrets[key] === null) {
      entries.push({ key, status: "Missing" });
      counts.missing += 1;
      continue;
    }
    const storedSecret = secrets[key];
    let secret: ConfigStoredSecret | null;
    if (isStringValue(storedSecret)) {
      secret = { expiresAt: null, value: storedSecret };
    } else if (isRecordValue(storedSecret)) {
      // SAFETY: stored snapshot secrets are either strings or records carrying a string value.
      secret = storedSecret as ConfigStoredSecret;
    } else {
      secret = null;
    }
    if (!secret || !isStringValue(secret.value)) {
      throw safeError("CONFIGURATION_EVALUATION_FAILED");
    }
    const { expiresAt } = secret;
    if (expiresAt !== null && expiresAt !== undefined) {
      if (!isStringValue(expiresAt)) {
        throw safeError("CONFIGURATION_EVALUATION_FAILED");
      }
      const expiry = Date.parse(expiresAt);
      if (!Number.isFinite(expiry)) {
        throw safeError("CONFIGURATION_EVALUATION_FAILED");
      }
      if (secret.value.length === 0) {
        entries.push({ key, status: "Empty" });
        counts.empty += 1;
        continue;
      }
      if (expiry <= evaluatedMs) {
        entries.push({ key, status: "Expired" });
        counts.expired += 1;
        continue;
      }
      nextExpiryMs = Math.min(nextExpiryMs, expiry);
    } else if (secret.value.length === 0) {
      entries.push({ key, status: "Empty" });
      counts.empty += 1;
      continue;
    }
    entries.push({ key, status: "Ready" });
    counts.ready += 1;
  }
  return {
    counts,
    entries,
    evaluatedAt: evaluated.toISOString(),
    nextExpiry: Number.isFinite(nextExpiryMs)
      ? new Date(nextExpiryMs).toISOString()
      : null,
  };
};

export const evaluate = (
  activeVault: ReviewVault,
  selector: BoundaryValue,
  baseline: ReviewBaselineSnapshot & { configurationBaseline: ReviewBaseline },
  target: ReviewBinding,
  now: Date
) => {
  const snapshot = activeVault.getImportProjectSnapshot(
    selector,
    baseline.configurationBaseline.requiredKeys
  );
  const result = evaluateSnapshot(
    baseline.configurationBaseline.requiredKeys,
    // SAFETY: snapshot secrets come from the unlocked Vault snapshot; narrow for evaluation.
    snapshot.secrets as Record<string, BoundaryValue>,
    now
  );
  return {
    configured: true,
    success: true,
    target: publicTarget(target),
    ...result,
  };
};

export const readLimitedFile = async (filePath: string): Promise<Buffer> => {
  let file;
  try {
    // Node file-open flags require a bitmask; nonblocking avoids hanging on special files.
    // eslint-disable-next-line no-bitwise
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
    file = await fs.promises.open(filePath, flags);
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw safeError("CONFIGURATION_INVALID_FILE");
    }
    if (stats.size > MAX_INPUT_BYTES) {
      throw safeError("CONFIGURATION_INPUT_TOO_LARGE");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let position = 0;
    while (total <= MAX_INPUT_BYTES) {
      const buffer = Buffer.alloc(
        Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - total)
      );
      // Each bounded read advances this file offset; parallel reads would race the limit.
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
    }
    if (total > MAX_INPUT_BYTES) {
      throw safeError("CONFIGURATION_INPUT_TOO_LARGE");
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error.code?.startsWith("CONFIGURATION_")) {
      throw error;
    }
    throw safeError("CONFIGURATION_FILE_READ_FAILED");
  } finally {
    try {
      await file?.close();
    } catch {
      // Closing is best effort and must not replace a read result or its error.
    }
  }
};

export const readTemplate = async (
  input: ValidTemplateInput
): Promise<TemplateResult> => {
  let content: string;
  if (input.source === "text") {
    const { content: text } = input;
    if (!isStringValue(text)) {
      throw safeError("CONFIGURATION_INVALID_INPUT");
    }
    if (Buffer.byteLength(text, "utf-8") > MAX_INPUT_BYTES) {
      throw safeError("CONFIGURATION_INPUT_TOO_LARGE");
    }
    content = text;
  } else {
    const { filePath } = input;
    if (!isStringValue(filePath) || filePath.length === 0) {
      throw safeError("CONFIGURATION_INVALID_INPUT");
    }
    const bytes = await readLimitedFile(filePath);
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const parsed = parseEnvironmentText(content);
  if (parsed.diagnostics.length > 0) {
    return {
      diagnostics: parsed.diagnostics.map(
        ({
          line,
          code,
          message,
        }: {
          line: number;
          code: string;
          message: string;
        }) => ({ code, line, message })
      ),
      duplicateNames: 0,
      requiredKeys: [],
    };
  }
  const occurrenceCounts = new Map<string, number>();
  for (const { key } of parsed.assignments) {
    occurrenceCounts.set(key, (occurrenceCounts.get(key) || 0) + 1);
  }
  let requiredKeys: string[];
  try {
    requiredKeys = normalizeRequiredKeys([...occurrenceCounts.keys()]);
  } catch {
    return {
      diagnostics: [
        {
          code: "invalid_template",
          line: 1,
          message: "The template does not contain a valid required-key list.",
        },
      ],
      duplicateNames: 0,
      requiredKeys: [],
    };
  }
  const duplicateNames = [...occurrenceCounts.values()].filter(
    (count) => count > 1
  ).length;
  parsed.assignments.length = 0;
  return { diagnostics: [], duplicateNames, requiredKeys };
};
