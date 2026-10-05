import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

import { getAppDataPath } from "../src/modules/app-data-path.js";

/** Environment protocol version required for explicit Environment requests. */
const REQUIRED_ENVIRONMENT_PROTOCOL_VERSION = 1;

const KEYHARBOR_DIR = getAppDataPath();
const SERVER_INFO_PATH = path.join(KEYHARBOR_DIR, "server-info.json");
const REQUEST_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

interface ServerInfo {
  authToken: string;
  host: string;
  pid: number;
  port: number;
}

type RequestData = Record<string, unknown>;
type ActionResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string; code?: string };
type ResponseCallback = (
  error: Error | null,
  response?: ActionResponse
) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validateServerInfo = (info: unknown): info is ServerInfo =>
  isRecord(info) &&
  typeof info.host === "string" &&
  LOOPBACK_HOSTS.has(info.host) &&
  typeof info.port === "number" &&
  Number.isInteger(info.port) &&
  info.port > 0 &&
  info.port <= 65_535 &&
  typeof info.authToken === "string" &&
  info.authToken.length > 0 &&
  typeof info.pid === "number" &&
  Number.isInteger(info.pid) &&
  info.pid > 0;

const isActionResponse = (value: unknown): value is ActionResponse =>
  isRecord(value) &&
  (value.success === true ||
    (value.success === false &&
      typeof value.error === "string" &&
      (value.code === undefined || typeof value.code === "string")));

const isProcessAlive = (
  pid: number,
  signalProcess: (
    pid: number,
    signal?: number | NodeJS.Signals
  ) => void = process.kill
): boolean => {
  try {
    signalProcess(pid, 0);
    return true;
  } catch (error) {
    return !isRecord(error) || error.code !== "ESRCH";
  }
};

const getServerInfo = (): ServerInfo | null => {
  try {
    if (!fs.existsSync(SERVER_INFO_PATH)) {
      return null;
    }
    const info: unknown = JSON.parse(
      fs.readFileSync(SERVER_INFO_PATH, "utf-8")
    );
    if (!validateServerInfo(info)) {
      return null;
    }
    if (isProcessAlive(info.pid)) {
      return info;
    }
    try {
      fs.unlinkSync(SERVER_INFO_PATH);
    } catch {
      // Another process may already have removed the stale discovery file.
    }
    return null;
  } catch {
    return null;
  }
};

const isElectronAppRunning = (): Promise<boolean> =>
  Promise.resolve(getServerInfo() !== null);

const postRequestWithCallback = (
  serverInfo: ServerInfo,
  action: string,
  data: RequestData,
  complete: ResponseCallback
): void => {
  const requestData = JSON.stringify({
    action,
    data,
    timestamp: new Date().toISOString(),
  });
  const req = http.request(
    {
      headers: {
        Authorization: `Bearer ${serverInfo.authToken}`,
        "Content-Length": Buffer.byteLength(requestData),
        "Content-Type": "application/json",
      },
      hostname: serverInfo.host,
      method: "POST",
      path: "/",
      port: serverInfo.port,
    },
    (res) => {
      // Decode across chunk boundaries so multi-byte Secret values remain intact.
      res.setEncoding("utf-8");
      let responseData = "";
      res.on("data", (chunk: string) => {
        responseData += chunk;
      });
      res.on("error", (error) => {
        complete(
          new Error(`Could not read KeyHarbor response: ${error.message}`)
        );
      });
      res.on("end", () => {
        try {
          const response: unknown = JSON.parse(responseData);
          if (res.statusCode !== 200) {
            const message =
              isRecord(response) &&
              typeof response.error === "string" &&
              response.error
                ? response.error
                : `KeyHarbor request failed with HTTP ${res.statusCode}`;
            complete(new Error(message));
            return;
          }
          if (!isActionResponse(response)) {
            complete(
              new Error(
                "Invalid response from KeyHarbor: expected an action result"
              )
            );
            return;
          }
          complete(null, response);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          complete(new Error(`Invalid response from KeyHarbor: ${message}`));
        }
      });
    }
  );
  req.on("error", (error) => {
    complete(new Error(`Could not connect to KeyHarbor: ${error.message}`));
  });
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    req.destroy(new Error("KeyHarbor request timed out"));
  });
  req.end(requestData);
};

const postRequestAsync = promisify(postRequestWithCallback);

const postRequest = async (
  serverInfo: ServerInfo,
  action: string,
  data: RequestData
): Promise<ActionResponse> => {
  const response = await postRequestAsync(serverInfo, action, data);
  if (!response) {
    throw new Error("Invalid response from KeyHarbor: missing action result");
  }
  return response;
};

/** A selector is explicit only when the caller supplied its field. */
const hasExplicitEnvironmentSelector = (data: RequestData): boolean =>
  Object.hasOwn(data, "environmentName") ||
  Object.hasOwn(data, "environmentId");

/** Older dispatchers ignore selectors; probe before sending a sensitive action. */
const assertEnvironmentProtocolSupported = async (
  serverInfo: ServerInfo
): Promise<void> => {
  const status = await postRequest(serverInfo, "status", {});
  if (
    !status.success ||
    !isRecord(status.data) ||
    status.data.environmentProtocolVersion !==
      REQUIRED_ENVIRONMENT_PROTOCOL_VERSION
  ) {
    throw new Error(
      "This KeyHarbor desktop server does not support explicit Environment requests. Update the desktop app before retrying."
    );
  }
};

const sendRequest = async (
  action: string,
  data: RequestData = {}
): Promise<ActionResponse> => {
  const serverInfo = getServerInfo();
  if (!serverInfo) {
    throw new Error(
      "KeyHarbor app is not running. Start and unlock the GUI application first."
    );
  }
  if (hasExplicitEnvironmentSelector(data) && action !== "status") {
    await assertEnvironmentProtocolSupported(serverInfo);
  }
  return postRequest(serverInfo, action, data);
};

const client = {
  KEYHARBOR_DIR,
  REQUIRED_ENVIRONMENT_PROTOCOL_VERSION,
  SERVER_INFO_PATH,
  getServerInfo,
  isElectronAppRunning,
  isProcessAlive,
  sendRequest,
  validateServerInfo,
};

export = client;
