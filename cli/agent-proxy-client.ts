import { once } from "node:events";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

import { AGENT_REQUEST_TIMEOUT_MS } from "../src/modules/agent-proxy-timeouts.js";

export interface AgentSession {
  sessionId: string;
  proxyUrl: string;
  caCertificate: string;
  expiresAt: string;
  placeholder: string;
  key: string;
  environmentName: string;
  projectName: string;
}

export interface AgentSessionRequest {
  projectName: string;
  environmentName?: string;
  vaultName?: string;
  key: string;
  origin: string;
  methods?: string[];
  pathPrefixes?: string[];
  ttlSeconds?: number;
  allowPrivateNetwork?: boolean;
  upstreamCaCertificate?: string;
  authHeader?: string;
  authPrefix?: string;
}

type ActionClient = (
  action: string,
  data: Record<string, unknown>
) => Promise<unknown>;
interface ActionResult {
  success?: boolean;
  data?: unknown;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const createAgentSession = async (
  client: ActionClient,
  request: AgentSessionRequest
): Promise<AgentSession> => {
  const result = (await client(
    "createAgentSession",
    request as unknown as Record<string, unknown>
  )) as ActionResult;
  if (!result?.success || !isRecord(result.data)) {
    throw new Error("KeyHarbor could not create an approved agent session.");
  }
  const { data } = result;
  if (
    typeof data.sessionId !== "string" ||
    typeof data.proxyUrl !== "string" ||
    typeof data.caCertificate !== "string" ||
    typeof data.expiresAt !== "string" ||
    typeof data.placeholder !== "string" ||
    typeof data.key !== "string" ||
    typeof data.environmentName !== "string" ||
    typeof data.projectName !== "string"
  ) {
    throw new TypeError("KeyHarbor returned an invalid agent session.");
  }
  return data as unknown as AgentSession;
};

export const closeAgentSession = async (
  client: ActionClient,
  sessionId: string
): Promise<void> => {
  try {
    await client("closeAgentSession", { sessionId });
  } catch {
    // Session TTL still bounds a failed best-effort revoke.
  }
};

export const createAgentEnvironment = (
  session: AgentSession,
  base = process.env
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (
      value !== undefined &&
      !/^KEYHARBOR_/iu.test(key) &&
      !/^LOCALKEYS_/iu.test(key) &&
      !["NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"].includes(key)
    ) {
      env[key] = value;
    }
  }
  env.HTTP_PROXY = session.proxyUrl;
  env.HTTPS_PROXY = session.proxyUrl;
  env.http_proxy = session.proxyUrl;
  env.https_proxy = session.proxyUrl;
  env.NO_PROXY = "";
  env.no_proxy = "";
  env.NODE_USE_ENV_PROXY = "1";
  return env;
};

export const writePublicCa = (
  directory: string,
  certificate: string
): string => {
  const path = `${directory}/agent-ca.pem`;
  fs.writeFileSync(path, certificate, { flag: "wx", mode: 0o600 });
  return path;
};

export const addCaEnvironment = (
  env: NodeJS.ProcessEnv,
  path: string
): void => {
  env.NODE_EXTRA_CA_CERTS = path;
  env.SSL_CERT_FILE = path;
  env.REQUESTS_CA_BUNDLE = path;
  env.CURL_CA_BUNDLE = path;
  env.GIT_SSL_CAINFO = path;
};

export interface AgentHttpRequest {
  origin: string;
  path: string;
  method: string;
  body?: string;
  proxyUrl: string;
  caCertificate: string;
}

const validateOrigin = (origin: URL): void => {
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Origin must be an HTTPS origin without a path.");
  }
};

const validatePath = (origin: URL, path: string): URL => {
  const hasForbiddenCharacter = [...path].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return char === "\\" || char === "#" || code <= 0x20 || code === 0x7f;
  });
  if (!path.startsWith("/") || path.startsWith("//") || hasForbiddenCharacter) {
    throw new Error("Invalid request path.");
  }
  const requestUrl = new URL(path, origin);
  if (requestUrl.origin !== origin.origin) {
    throw new Error("Request path must stay within the approved origin.");
  }
  return requestUrl;
};

const validateMethod = (method: string): string => {
  if (!/^[A-Za-z0-9!#$%&'*+.^_|~-]+$/u.test(method)) {
    throw new Error("Invalid HTTP method.");
  }
  return method.toUpperCase();
};

export const getAgentRequestPathname = (originText: string, path: string) => {
  const origin = new URL(originText);
  validateOrigin(origin);
  return validatePath(origin, path).pathname;
};

// eslint-disable-next-line complexity -- This function owns one bounded, one-shot proxy request lifecycle.
export const requestThroughAgentProxy = async (
  request: AgentHttpRequest
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> => {
  if (Buffer.byteLength(request.body ?? "", "utf-8") > 256 * 1024) {
    throw new Error("Request body exceeds 256 KiB.");
  }
  const origin = new URL(request.origin);
  validateOrigin(origin);
  const requestUrl = validatePath(origin, request.path);
  const method = validateMethod(request.method);
  const proxy = new URL(request.proxyUrl);
  if (
    proxy.protocol !== "http:" ||
    !["127.0.0.1", "::1", "localhost"].includes(proxy.hostname) ||
    !proxy.port ||
    !proxy.username
  ) {
    throw new Error("Invalid approved proxy endpoint.");
  }
  let socket: net.Socket | undefined;
  let secure: tls.TLSSocket | undefined;
  let agent: https.Agent | undefined;
  try {
    socket = net.connect(Number(proxy.port), proxy.hostname);
    socket.setTimeout(AGENT_REQUEST_TIMEOUT_MS, () =>
      socket?.destroy(new Error("Proxy request timed out."))
    );
    await once(socket, "connect");
    const auth = Buffer.from(
      `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
    ).toString("base64");
    socket.write(
      `CONNECT ${origin.hostname}:${origin.port || 443} HTTP/1.1\r\nHost: ${origin.hostname}:${origin.port || 443}\r\nProxy-Authorization: Basic ${auth}\r\nConnection: keep-alive\r\n\r\n`
    );
    // eslint-disable-next-line no-use-before-define -- The helper is initialized before this async function runs.
    const head = await readUntilHeader(socket, 8192);
    if (!/^HTTP\/1\.[01] 200\b/u.test(head)) {
      throw new Error("Approved proxy tunnel was refused.");
    }
    secure = tls.connect({
      ca: request.caCertificate,
      host: origin.hostname,
      rejectUnauthorized: true,
      servername: net.isIP(origin.hostname) ? undefined : origin.hostname,
      socket,
    });
    secure.setTimeout(AGENT_REQUEST_TIMEOUT_MS, () =>
      secure?.destroy(new Error("HTTPS request timed out."))
    );
    await once(secure, "secureConnect");

    agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
    agent.createConnection = () => secure as tls.TLSSocket;
    // eslint-disable-next-line promise/avoid-new -- Node's HTTP event API needs one result promise.
    // eslint-disable-next-line promise/avoid-new -- Node's HTTP event API needs one result promise.
    const response = await new Promise<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }>((resolve, reject) => {
      const req = https.request(requestUrl, {
        agent,
        headers: {
          Connection: "close",
          ...(request.body === undefined
            ? {}
            : {
                "Content-Length": Buffer.byteLength(request.body),
                "Content-Type": "application/json",
              }),
        },
        method,
      });
      req.setTimeout(AGENT_REQUEST_TIMEOUT_MS, () =>
        req.destroy(new Error("HTTPS request timed out."))
      );
      req.once("error", reject);
      req.once("response", (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.destroy(new Error("Response exceeds 1 MiB."));
            return;
          }
          chunks.push(chunk);
        });
        res.once("error", reject);
        res.once("end", () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
              headers[name] = Array.isArray(value)
                ? value.join(", ")
                : String(value);
            }
          }
          resolve({
            body: Buffer.concat(chunks).toString("utf-8"),
            headers,
            status: res.statusCode ?? 0,
          });
        });
      });
      req.end(request.body);
    });
    return response;
  } finally {
    agent?.destroy();
    secure?.destroy();
    socket?.destroy();
  }
};

// eslint-disable-next-line eslint/func-style -- Function expression is required for its event callback references.
const readUntilHeader = (socket: net.Socket, max: number): Promise<string> =>
  // eslint-disable-next-line promise/avoid-new -- CONNECT is a bounded socket event boundary.
  new Promise((resolve, reject) => {
    let data = "";
    let settled = false;
    let onData: (chunk: Buffer) => void; // eslint-disable-line prefer-const -- Callback closes over finish and cleanup.
    let onError: (error: Error) => void; // eslint-disable-line prefer-const -- Callback closes over finish.
    let onEnd: () => void; // eslint-disable-line prefer-const -- Callback closes over finish.
    let onClose: () => void; // eslint-disable-line prefer-const -- Callback closes over finish.
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.off("close", onClose);
    };
    const finish = (error?: Error, value?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(value ?? "");
      }
    };
    onData = (chunk: Buffer) => {
      data += chunk.toString("latin1");
      if (data.length > max) {
        finish(new Error("Proxy response header too large."));
        return;
      }
      const end = data.indexOf("\r\n\r\n");
      if (end !== -1) {
        finish(undefined, data.slice(0, end));
      }
    };
    onError = (error: Error) => finish(error);
    onEnd = () => finish(new Error("Proxy closed before CONNECT completed."));
    onClose = () => finish(new Error("Proxy closed before CONNECT completed."));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("close", onClose);
  });
