import * as https from "node:https";
import { URL } from "node:url";

import { isNewerVersion } from "./version";

export const UPDATE_CHECK_URL =
  "https://api.github.com/repos/varunyn/KeyHarbor/releases/latest";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_INITIAL_DELAY_MS = 2000;

export type UpdateCheckOutcome =
  | { status: "newer"; version: string }
  | { status: "current"; version: null }
  | { status: "failed"; version: null };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

interface ReleaseResponse {
  tag_name?: unknown;
}

export const normalizeReleaseTag = (tag: string): string =>
  tag.trim().replace(/^v/u, "");

export const selectNewerVersion = (
  candidate: string,
  current: string
): string | null => {
  const normalized = normalizeReleaseTag(candidate);
  if (normalized.length === 0) {
    return null;
  }
  return isNewerVersion(normalized, current) ? normalized : null;
};

const extractTagName = (body: string): string | null => {
  try {
    const parsed: ReleaseResponse = JSON.parse(body);
    if (isNonEmptyString(parsed.tag_name)) {
      return normalizeReleaseTag(parsed.tag_name);
    }
    return null;
  } catch {
    return null;
  }
};

export const fetchLatestReleaseTag = (): Promise<string | null> => {
  try {
    // Node HTTPS reports completion through response/error events, requiring a Promise adapter.
    // eslint-disable-next-line promise/avoid-new
    return new Promise((resolve) => {
      const url = new URL(UPDATE_CHECK_URL);
      const req = https.request(
        url,
        {
          headers: { "User-Agent": "KeyHarbor-App" },
          method: "GET",
          timeout: 5000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }
            const tag = extractTagName(data);
            resolve(tag && tag.length > 0 ? tag : null);
          });
        }
      );
      req.on("error", () => {
        resolve(null);
      });
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  } catch {
    return Promise.resolve(null);
  }
};

export const checkForUpdate = async (
  currentVersion: string,
  fetchLatest: () => Promise<string | null> = fetchLatestReleaseTag
): Promise<UpdateCheckOutcome> => {
  try {
    const tag = await fetchLatest();
    if (!isNonEmptyString(tag)) {
      return { status: "failed", version: null };
    }
    const newer = selectNewerVersion(tag, currentVersion);
    if (newer) {
      return { status: "newer", version: newer };
    }
    return { status: "current", version: null };
  } catch {
    return { status: "failed", version: null };
  }
};

export interface UpdatePollingOptions {
  isEnabled: () => boolean;
  check: () => Promise<string | null>;
  onUpdate: (version: string) => void;
  initialDelayMs?: number;
  intervalMs?: number;
}

/** Poll on startup and daily while enabled. Returns a stop function. */
export const startUpdatePolling = (
  options: UpdatePollingOptions
): (() => void) => {
  const initialDelayMs =
    options.initialDelayMs ?? UPDATE_CHECK_INITIAL_DELAY_MS;
  const intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
  let stopped = false;
  let checking = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const poll = async (): Promise<void> => {
    if (stopped || checking || !options.isEnabled()) {
      return;
    }
    checking = true;
    try {
      const version = await options.check();
      if (!stopped && version && options.isEnabled()) {
        options.onUpdate(version);
      }
    } catch {
      // Update checks never interrupt the desktop lifecycle.
    } finally {
      checking = false;
    }
  };

  initialTimer = setTimeout(() => {
    void poll();
    if (!stopped && interval === null) {
      interval = setInterval(() => {
        void poll();
      }, intervalMs);
    }
  }, initialDelayMs);

  return () => {
    stopped = true;
    if (initialTimer !== null) {
      clearTimeout(initialTimer);
      initialTimer = null;
    }
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
};
