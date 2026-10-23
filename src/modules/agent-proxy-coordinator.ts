import { spawn } from "node:child_process";
import crypto from "node:crypto";

import type {
  AgentProxyApprovalRequest,
  AgentProxyCoordinatorOptions,
  AgentProxyCreateSessionData,
  AgentProxySessionInfo,
  AgentProxyTargetIdentity,
} from "./agent-proxy-contracts";
import { AGENT_APPROVAL_TIMEOUT_MS } from "./agent-proxy-timeouts";

const MAX_LINE = 2 * 1024 * 1024;
const MAX_SESSIONS = 8;
const MAX_PENDING_REQUESTS = 32;
const SECRET_PLACEHOLDER = "KEYHARBOR_SECRET";
const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const DEFAULT_PATHS = ["/"];
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/u;
const HEADER_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const safeString = (value: unknown, label: string, maximum = 256): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted protocol strings.
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
};
const sameIdentity = (
  a: AgentProxyTargetIdentity,
  b: AgentProxyTargetIdentity
): boolean =>
  a.projectName === b.projectName &&
  a.projectIncarnation === b.projectIncarnation &&
  a.environmentId === b.environmentId &&
  a.environmentName === b.environmentName &&
  a.environmentIncarnation === b.environmentIncarnation;
const abortError = () =>
  Object.assign(new Error("Proxy session ended"), { name: "AbortError" });

interface PendingRequest {
  finish: (status: number) => void;
  promise: Promise<number>;
}
interface SessionRecord {
  id: string;
  token: string;
  child: ReturnType<typeof spawn>;
  controller: AbortController;
  expiresAt: number;
  port: number;
  origin: string;
  methods: string[];
  pathPrefixes: string[];
  allowPrivateNetwork: boolean;
  vaultName: string;
  projectName: string;
  environmentName: string;
  environmentId: string;
  vaultId: string;
  vaultInstanceId: string;
  identity: AgentProxyTargetIdentity;
  key: string;
  authHeader: string;
  authPrefix: string;
  pending: Map<string, PendingRequest>;
  buffer: string;
  ready?: (value: { port: number; caCertificate: string }) => void;
  readyReject?: (error: Error) => void;
  closed: boolean;
}

const normalizeOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Origin must be a valid HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value !== url.origin
  ) {
    throw new TypeError(
      "Origin must be an exact HTTPS origin without a path, query, or credentials"
    );
  }
  return url.origin;
};
const normalizeMethods = (values?: string[]): string[] => {
  const methods = values ?? DEFAULT_METHODS;
  if (!Array.isArray(methods) || methods.length < 1 || methods.length > 16) {
    throw new TypeError("Methods are invalid");
  }
  const result = [
    ...new Set(
      methods.map((value) => safeString(value, "Method", 16).toUpperCase())
    ),
  ];
  if (
    result.some(
      (method) =>
        !/^[A-Z][A-Z0-9-]*$/u.test(method) ||
        ["CONNECT", "TRACE"].includes(method)
    )
  ) {
    throw new TypeError("Methods contain an unsupported value");
  }
  return result;
};
const normalizePaths = (values?: string[]): string[] => {
  const paths = values ?? DEFAULT_PATHS;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 64) {
    throw new TypeError("Path prefixes are invalid");
  }
  return [
    ...new Set(
      paths.map((value) => {
        const item = safeString(value, "Path prefix", 512);
        if (
          !item.startsWith("/") ||
          item.startsWith("//") ||
          item.includes("\\") ||
          /%(?:2f|5c|00)/iu.test(item) ||
          item.includes("?") ||
          item.includes("#")
        ) {
          throw new TypeError("Path prefix is invalid");
        }
        const parsed = new URL(item, "https://keyharbor.invalid");
        if (parsed.pathname !== item || item.split("/").includes("..")) {
          throw new TypeError("Path prefix is invalid");
        }
        return item;
      })
    ),
  ];
};
const withinPath = (path: string, prefixes: string[]): boolean =>
  prefixes.some(
    (prefix) =>
      path === prefix ||
      (prefix.endsWith("/")
        ? path.startsWith(prefix)
        : path.startsWith(`${prefix}/`))
  );
const credentialField =
  /(?:password|secret|token|authorization|api[_-]?key|credential)/iu;
const encodedSecretForms = (secret: string): string[] => {
  if (!secret) {
    return [];
  }
  const forms = new Set([
    secret,
    encodeURIComponent(secret),
    encodeURIComponent(secret).toLowerCase(),
    encodeURI(secret),
    encodeURI(secret).toLowerCase(),
    Buffer.from(secret, "utf-8").toString("base64"),
    Buffer.from(secret, "utf-8").toString("base64url"),
    Buffer.from(secret, "utf-8").toString("hex"),
  ]);
  return [...forms].filter(Boolean);
};
const redactSelectedSecret = (value: string, secret: string): string => {
  let redacted = value;
  for (const form of encodedSecretForms(secret)) {
    if (form.includes("%")) {
      const pattern = form
        .replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")
        .replaceAll(/%[\da-f]{2}/giu, (escape) => {
          const [, first, second] = escape;
          return `%[${first.toLowerCase()}${first.toUpperCase()}][${second.toLowerCase()}${second.toUpperCase()}]`;
        });
      redacted = redacted.replaceAll(new RegExp(pattern, "gu"), "[REDACTED]");
    } else {
      redacted = redacted.split(form).join("[REDACTED]");
    }
  }
  return redacted;
};
const redactBodyValue = (value: unknown, secret: string): unknown => {
  if (typeof value === "string") {
    return redactSelectedSecret(value, secret);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactBodyValue(item, secret));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactSelectedSecret(key, secret),
        credentialField.test(key)
          ? "[REDACTED]"
          : redactBodyValue(item, secret),
      ])
    );
  }
  return value;
};
const bodyPreview = (bodyBase64: string, secret: string): string => {
  const bytes = Buffer.from(bodyBase64, "base64");
  const text = new TextDecoder("utf-8", { fatal: true });
  let preview: string;
  try {
    const decoded = text.decode(bytes);
    try {
      preview = JSON.stringify(
        redactBodyValue(JSON.parse(decoded) as unknown, secret)
      );
    } catch {
      preview = decoded
        .replaceAll(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
        .replaceAll(
          /(?<field>(?:password|secret|token|authorization|api[_-]?key|credential)\s*[=:]\s*)[^\s&,;]+/giu,
          "$<field>[REDACTED]"
        );
      preview = redactSelectedSecret(preview, secret);
    }
  } catch {
    preview = `[binary body, ${bytes.length} bytes]`;
  }
  return preview.length > 4096
    ? `${preview.slice(0, 4096)}… [truncated]`
    : preview;
};
const approvalPath = (url: URL, secret: string): string => {
  const pathname = redactSelectedSecret(url.pathname, secret);
  const query = [...url.searchParams.entries()].map(([key, value]) => {
    const sensitive =
      credentialField.test(key) ||
      encodedSecretForms(secret).some(
        (form) => key.includes(form) || value.includes(form)
      ) ||
      /\bBearer\s+\S+/iu.test(value);
    return `${encodeURIComponent(sensitive ? "[REDACTED]" : redactSelectedSecret(key, secret))}=${encodeURIComponent(
      sensitive ? "[REDACTED]" : redactSelectedSecret(value, secret)
    )}`;
  });
  return `${pathname}${query.length ? `?${query.join("&")}` : ""}`;
};

class AgentProxyCoordinator {
  private readonly options: AgentProxyCoordinatorOptions;
  private readonly sessions = new Map<string, SessionRecord>();
  private pendingConnections = 0;
  private generation = 0;

  constructor(options: AgentProxyCoordinatorOptions) {
    if (
      !options ||
      !options.session ||
      typeof options.session.withActiveSession !== "function" ||
      !options.helperPath ||
      typeof options.approve !== "function"
    ) {
      throw new TypeError("Agent proxy coordinator dependencies are required");
    }
    this.options = options;
  }

  // eslint-disable-next-line complexity -- This method validates user scope, obtains connection approval, and starts the scoped helper.
  async createSession(data: unknown): Promise<AgentProxySessionInfo> {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError("Session data is required");
    }
    const input = data as AgentProxyCreateSessionData;
    if (this.sessions.size + this.pendingConnections >= MAX_SESSIONS) {
      throw new Error("Proxy session limit reached");
    }
    const projectName = safeString(input.projectName, "Project name");
    const vaultName = safeString(input.vaultName ?? "System", "Vault name");
    const key = safeString(input.key, "Secret key");
    const origin = normalizeOrigin(safeString(input.origin, "Origin", 2048));
    const methods = normalizeMethods(input.methods);
    const pathPrefixes = normalizePaths(input.pathPrefixes);
    const ttl = input.ttlSeconds ?? 900;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 3600) {
      throw new TypeError("TTL must be between 30 and 3600 seconds");
    }
    const environmentName =
      input.environmentName === undefined
        ? undefined
        : safeString(input.environmentName, "Environment name");
    if (
      input.allowPrivateNetwork !== undefined &&
      typeof input.allowPrivateNetwork !== "boolean"
    ) {
      throw new TypeError("Private network exception must be a boolean");
    }
    const allowPrivateNetwork = input.allowPrivateNetwork === true;
    const { upstreamCaCertificate } = input;
    if (upstreamCaCertificate !== undefined) {
      if (
        typeof upstreamCaCertificate !== "string" ||
        Buffer.byteLength(upstreamCaCertificate, "utf-8") > 256 * 1024
      ) {
        throw new TypeError("Upstream CA certificate is invalid");
      }
      try {
        if (!new crypto.X509Certificate(upstreamCaCertificate).ca) {
          throw new TypeError("Upstream certificate must be a CA certificate");
        }
      } catch {
        throw new TypeError("Upstream CA certificate is invalid");
      }
    }
    const authHeader = safeString(
      input.authHeader ?? "Authorization",
      "Authentication header",
      128
    );
    if (!HEADER_PATTERN.test(authHeader)) {
      throw new TypeError("Authentication header is invalid");
    }
    if (
      [
        "connection",
        "host",
        "keep-alive",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
      ].includes(authHeader.toLowerCase())
    ) {
      throw new TypeError("Authentication header is not permitted");
    }
    const authPrefix =
      input.authPrefix === ""
        ? ""
        : safeString(input.authPrefix ?? "Bearer", "Authentication prefix", 64);
    if (authPrefix && !TOKEN_PATTERN.test(authPrefix)) {
      throw new TypeError("Authentication prefix is invalid");
    }
    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    const createGeneration = this.generation;
    this.pendingConnections += 1;
    let target: {
      identity: AgentProxyTargetIdentity;
      target: { projectName: string; environmentId: string };
      vaultId: string;
      vaultInstanceId: string;
    };
    try {
      target = await this.options.session.withActiveSession(async (context) => {
        const vault = await context.vaults.getByName(vaultName);
        if (!vault) {
          throw new Error("Vault is unavailable");
        }
        const environmentSelector =
          environmentName === undefined ? {} : { environmentName };
        const resolvedTarget = vault.resolveEnvironmentTarget({
          projectName,
          ...environmentSelector,
        });
        const identity = vault.getEnvironmentTargetIdentity(resolvedTarget);
        const secret = vault.getSecret(resolvedTarget, key);
        if (secret.expiresAt && Date.parse(secret.expiresAt) <= Date.now()) {
          throw new Error("Credential has expired");
        }
        if (typeof secret.value !== "string" || secret.value.length === 0) {
          throw new Error("Credential is unavailable");
        }
        const request: AgentProxyApprovalRequest = {
          action: "connect",
          environmentId: resolvedTarget.environmentId,
          environmentName: identity.environmentName,
          keys: [key],
          methods: [...methods],
          origin,
          pathPrefixes: [...pathPrefixes],
          projectName,
          vaultId: vault.getVaultId(),
          vaultInstanceId: vault.getVaultInstanceId(),
          vaultName,
          ...(allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
          ...(upstreamCaCertificate ? { customTrust: true } : {}),
        };
        const decision = await this.approve(request, context.signal);
        if (!decision.approved) {
          this.options.logAccess?.({
            action: "connect",
            approved: false,
            environmentId: identity.environmentId,
            environmentName: identity.environmentName,
            key,
            origin,
            projectName,
            vaultId: vault.getVaultId(),
            vaultInstanceId: vault.getVaultInstanceId(),
          });
          throw new Error("Proxy session was not approved");
        }
        const current = vault.getEnvironmentTargetIdentity(resolvedTarget);
        if (!sameIdentity(identity, current)) {
          throw new Error("Target changed. Request approval again.");
        }
        const currentSecret = vault.getSecret(resolvedTarget, key);
        if (
          currentSecret.expiresAt &&
          Date.parse(currentSecret.expiresAt) <= Date.now()
        ) {
          throw new Error("Credential has expired");
        }
        if (typeof currentSecret.value !== "string" || !currentSecret.value) {
          throw new Error("Credential is unavailable");
        }
        this.options.logAccess?.({
          action: "connect",
          approved: true,
          environmentId: identity.environmentId,
          environmentName: identity.environmentName,
          key,
          origin,
          projectName,
          vaultId: vault.getVaultId(),
          vaultInstanceId: vault.getVaultInstanceId(),
        });
        return {
          identity,
          target: resolvedTarget,
          vaultId: vault.getVaultId(),
          vaultInstanceId: vault.getVaultInstanceId(),
        };
      });
    } catch (error) {
      this.pendingConnections -= 1;
      throw error;
    }
    this.pendingConnections -= 1;
    if (this.generation !== createGeneration) {
      throw abortError();
    }
    const child = spawn(this.options.helperPath, [], {
      env: {
        HOME: process.env.HOME ?? "",
        LANG: "C",
        PATH: process.env.PATH ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
      },
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const record: SessionRecord = {
      allowPrivateNetwork,
      authHeader,
      authPrefix,
      buffer: "",
      child,
      closed: false,
      controller: new AbortController(),
      environmentId: target.target.environmentId,
      environmentName: target.identity.environmentName,
      expiresAt: Date.now() + ttl * 1000,
      id: sessionId,
      identity: target.identity,
      key,
      methods,
      origin,
      pathPrefixes,
      pending: new Map(),
      port: 0,
      projectName,
      token,
      vaultId: target.vaultId,
      vaultInstanceId: target.vaultInstanceId,
      vaultName,
    };
    this.sessions.set(sessionId, record);
    this.watchChild(record);
    const expiryTimer = setTimeout(() => this.close(sessionId), ttl * 1000);
    expiryTimer.unref();
    // eslint-disable-next-line promise/avoid-new -- Child readiness is completed by the private helper protocol.
    const ready = new Promise<{ port: number; caCertificate: string }>(
      (resolve, reject) => {
        record.ready = resolve;
        record.readyReject = reject;
      }
    );
    const configuration = {
      allowPrivateNetwork: record.allowPrivateNetwork,
      authHeader,
      authPrefix,
      methods,
      origin,
      pathPrefixes,
      placeholder: SECRET_PLACEHOLDER,
      token,
      ttlSeconds: ttl,
      type: "configure",
      ...(upstreamCaCertificate ? { upstreamCaCertificate } : {}),
    };
    this.write(record, configuration);
    const timer = setTimeout(
      () =>
        record.readyReject?.(new Error("Proxy helper did not become ready")),
      10_000
    );
    try {
      const endpoint = await ready;
      clearTimeout(timer);
      record.port = endpoint.port;
      return {
        caCertificate: endpoint.caCertificate,
        environmentName: record.environmentName,
        expiresAt: new Date(record.expiresAt).toISOString(),
        key,
        placeholder: SECRET_PLACEHOLDER,
        projectName,
        proxyUrl: `http://${token}:vault@127.0.0.1:${endpoint.port}`,
        sessionId,
      };
    } catch (error) {
      clearTimeout(timer);
      this.close(sessionId);
      throw error;
    }
  }

  close(sessionId: string): void {
    if (typeof sessionId !== "string") {
      return;
    }
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }
    this.sessions.delete(sessionId);
    record.closed = true;
    record.controller.abort();
    record.readyReject?.(abortError());
    for (const pending of record.pending.values()) {
      pending.finish(0);
    }
    record.pending.clear();
    if (record.child.exitCode === null) {
      record.child.kill("SIGTERM");
    }
    const killTimer = setTimeout(() => {
      if (record.child.exitCode === null) {
        record.child.kill("SIGKILL");
      }
    }, 500);
    killTimer.unref();
  }

  clear(): void {
    this.generation += 1;
    for (const id of this.sessions.keys()) {
      this.close(id);
    }
  }

  // eslint-disable-next-line class-methods-use-this -- The method is grouped with protocol writing lifecycle operations.
  private write(record: SessionRecord, message: unknown): void {
    if (!record.closed) {
      record.child.stdin?.write(`${JSON.stringify(message)}\n`);
    }
  }

  private watchChild(record: SessionRecord): void {
    record.child.stdout?.on("data", (chunk: Buffer) =>
      this.onData(record, chunk)
    );
    record.child.on("error", () => this.close(record.id));
    record.child.on("exit", () => this.close(record.id));
  }

  private onData(record: SessionRecord, chunk: Buffer): void {
    if (record.closed) {
      return;
    }
    record.buffer += chunk.toString("utf-8");
    if (
      Buffer.byteLength(record.buffer, "utf-8") > MAX_LINE &&
      !record.buffer.includes("\n")
    ) {
      this.close(record.id);
      return;
    }
    while (true) {
      const index = record.buffer.indexOf("\n");
      if (index === -1) {
        break;
      }
      const line = record.buffer.slice(0, index);
      record.buffer = record.buffer.slice(index + 1);
      if (Buffer.byteLength(line, "utf-8") > MAX_LINE) {
        this.close(record.id);
        return;
      }
      try {
        this.onMessage(record, JSON.parse(line) as Record<string, unknown>);
      } catch {
        this.close(record.id);
        return;
      }
    }
  }

  private onMessage(
    record: SessionRecord,
    message: Record<string, unknown>
  ): void {
    if (message.type === "ready") {
      if (
        !Number.isInteger(message.port) ||
        (message.port as number) < 1 ||
        (message.port as number) > 65_535 ||
        typeof message.caCertificate !== "string" ||
        message.caCertificate.length > 256 * 1024
      ) {
        throw new Error("Invalid helper response");
      }
      record.ready?.({
        caCertificate: message.caCertificate,
        port: message.port as number,
      });
      return;
    }
    if (message.type === "complete" && typeof message.id === "string") {
      record.pending
        .get(message.id)
        ?.finish(typeof message.status === "number" ? message.status : 0);
      return;
    }
    if (message.type === "authorize") {
      void this.authorize(record, message);
      return;
    }
    throw new Error("Invalid helper message");
  }

  // eslint-disable complexity -- Validation, approval, stale-state checks, and lease lifetime are one security boundary.
  private async authorize(
    record: SessionRecord,
    message: Record<string, unknown>
  ): Promise<void> {
    const id =
      typeof message.id === "string" && message.id.length <= 128
        ? message.id
        : "";
    let finish!: (status: number) => void;
    // eslint-disable-next-line promise/avoid-new -- The helper's complete message settles this request lease.
    const promise = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const pending = { finish, promise };
    if (
      !id ||
      record.pending.has(id) ||
      record.pending.size >= MAX_PENDING_REQUESTS ||
      record.closed
    ) {
      this.write(record, { approved: false, id, type: "authorization" });
      return;
    }
    record.pending.set(id, pending);
    try {
      await this.options.session.withActiveSession(async (context) => {
        if (
          record.closed ||
          Date.now() >= record.expiresAt ||
          context.signal.aborted
        ) {
          throw abortError();
        }
        const method = safeString(message.method, "Method", 16).toUpperCase();
        if (!record.methods.includes(method)) {
          throw new Error("Request is outside the approved policy");
        }
        const url = new URL(safeString(message.url, "Request URL", 4096));
        if (
          url.origin !== record.origin ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.hash ||
          !withinPath(url.pathname, record.pathPrefixes)
        ) {
          throw new Error("Request is outside the approved policy");
        }
        const headers = this.validateHeaders(message.headers);
        const authHeaderName = record.authHeader.toLowerCase();
        const forbiddenHeaders = new Set([
          "connection",
          "host",
          "keep-alive",
          "proxy-authorization",
          "proxy-connection",
          "te",
          "trailer",
          "transfer-encoding",
          "upgrade",
        ]);
        if (Object.keys(headers).some((name) => forbiddenHeaders.has(name))) {
          throw new Error("Request contains a forbidden authentication header");
        }
        if (
          headers[authHeaderName] !== undefined &&
          headers[authHeaderName] !== SECRET_PLACEHOLDER &&
          headers[authHeaderName] !==
            `${record.authPrefix} ${SECRET_PLACEHOLDER}`
        ) {
          throw new Error(
            "Authentication header must use the supplied placeholder"
          );
        }
        let bodyBase64 = "";
        if (message.bodyBase64 !== undefined && message.bodyBase64 !== "") {
          bodyBase64 = safeString(message.bodyBase64, "Request body", MAX_LINE);
        }
        if (
          bodyBase64 &&
          (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
            bodyBase64
          ) ||
            Buffer.from(bodyBase64, "base64").length > 256 * 1024)
        ) {
          throw new Error("Request body exceeds the allowed size");
        }
        const digest = crypto
          .createHash("sha256")
          .update(
            `${method}\n${url.href}\n${JSON.stringify(headers)}\n${bodyBase64}`
          )
          .digest("hex");
        const vault = await context.vaults.getByName(record.vaultName);
        if (!vault) {
          throw new Error("Vault is unavailable");
        }
        if (
          vault.getVaultId() !== record.vaultId ||
          vault.getVaultInstanceId() !== record.vaultInstanceId
        ) {
          throw new Error("Vault changed. Create a new proxy session.");
        }
        const requestTarget = {
          environmentId: record.environmentId,
          projectName: record.projectName,
        };
        if (
          !sameIdentity(
            record.identity,
            vault.getEnvironmentTargetIdentity(requestTarget)
          )
        ) {
          throw new Error("Target changed. Create a new proxy session.");
        }
        const approvedSecret = vault.getSecret(requestTarget, record.key);
        if (
          approvedSecret.expiresAt &&
          Date.parse(approvedSecret.expiresAt) <= Date.now()
        ) {
          throw new Error("Credential has expired");
        }
        if (
          typeof approvedSecret.value !== "string" ||
          approvedSecret.value.length === 0 ||
          approvedSecret.value.length > 1024 * 1024
        ) {
          throw new Error("Credential is unavailable");
        }
        const request: AgentProxyApprovalRequest = {
          action: "use",
          bodyBytes: Buffer.from(bodyBase64, "base64").length,
          environmentId: record.environmentId,
          environmentName: record.environmentName,
          keys: [record.key],
          method,
          origin: record.origin,
          path: approvalPath(url, approvedSecret.value),
          projectName: record.projectName,
          requestDigest: digest,
          vaultId: record.vaultId,
          vaultInstanceId: record.vaultInstanceId,
          vaultName: record.vaultName,
          ...(bodyBase64
            ? { bodyPreview: bodyPreview(bodyBase64, approvedSecret.value) }
            : {}),
        };
        const decision = await this.approve(request, context.signal);
        if (
          !decision.approved ||
          record.closed ||
          Date.now() >= record.expiresAt ||
          context.signal.aborted
        ) {
          throw new Error("Proxy request was not approved");
        }
        const currentVault = await context.vaults.getByName(record.vaultName);
        if (!currentVault) {
          throw new Error("Vault is unavailable");
        }
        if (
          currentVault.getVaultId() !== record.vaultId ||
          currentVault.getVaultInstanceId() !== record.vaultInstanceId ||
          !sameIdentity(
            record.identity,
            currentVault.getEnvironmentTargetIdentity(requestTarget)
          )
        ) {
          throw new Error("Target changed. Request approval again.");
        }
        const secret = currentVault.getSecret(requestTarget, record.key);
        if (secret.expiresAt && Date.parse(secret.expiresAt) <= Date.now()) {
          throw new Error("Credential has expired");
        }
        if (
          typeof secret.value !== "string" ||
          secret.value !== approvedSecret.value
        ) {
          throw new Error("Credential changed. Request approval again.");
        }
        const active = record.pending.get(id);
        if (!active || active !== pending || record.closed) {
          throw abortError();
        }
        this.write(record, {
          approved: true,
          headerName: record.authHeader,
          headerValue: record.authPrefix
            ? `${record.authPrefix} ${secret.value}`
            : secret.value,
          id,
          redactionValues: [secret.value],
          type: "authorization",
        });
        const status = await this.waitForComplete(
          record,
          pending,
          context.signal
        );
        if (status > 0) {
          this.options.logAccess?.({
            action: "use",
            approved: true,
            environmentId: record.environmentId,
            environmentName: record.environmentName,
            key: record.key,
            method,
            origin: record.origin,
            projectName: record.projectName,
            vaultId: record.vaultId,
            vaultInstanceId: record.vaultInstanceId,
          });
        }
      });
    } catch {
      this.options.logAccess?.({
        action: "use",
        approved: false,
        environmentId: record.environmentId,
        environmentName: record.environmentName,
        key: record.key,
        origin: record.origin,
        projectName: record.projectName,
        vaultId: record.vaultId,
        vaultInstanceId: record.vaultInstanceId,
      });
      this.write(record, { approved: false, id, type: "authorization" });
      pending.finish(0);
    } finally {
      if (record.pending.get(id) === pending) {
        record.pending.delete(id);
      }
    }
  }
  // eslint-enable complexity

  private async approve(
    request: AgentProxyApprovalRequest,
    parentSignal: AbortSignal
  ): Promise<{ approved: boolean; reason?: string }> {
    if (parentSignal.aborted) {
      throw abortError();
    }
    const controller = new AbortController();
    let rejectAbort!: (error: Error) => void;
    // eslint-disable-next-line promise/avoid-new -- Parent cancellation must race an unresponsive approval callback.
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abort = () => {
      controller.abort();
      rejectAbort(abortError());
    };
    parentSignal.addEventListener("abort", abort, { once: true });
    if (parentSignal.aborted) {
      abort();
    }
    let timer: NodeJS.Timeout | undefined;
    // eslint-disable-next-line promise/avoid-new -- Approval must stop after a bounded wait and cancel its UI request.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Approval timed out"));
      }, AGENT_APPROVAL_TIMEOUT_MS);
      timer.unref();
    });
    try {
      return await Promise.race([
        this.options.approve(request, controller.signal),
        timeout,
        aborted,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      parentSignal.removeEventListener("abort", abort);
    }
  }

  // eslint-disable-next-line class-methods-use-this -- Header validation belongs to the coordinator protocol boundary.
  private validateHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Request headers are invalid");
    }
    const entries = Object.entries(value);
    if (entries.length > 128) {
      throw new TypeError("Too many request headers");
    }
    const result: Record<string, string> = Object.create(null);
    let bytes = 0;
    for (const [name, raw] of entries) {
      if (
        !HEADER_PATTERN.test(name) ||
        typeof raw !== "string" ||
        // eslint-disable-next-line no-control-regex -- Reject header injection bytes.
        /[\r\n\u0000]/u.test(raw) ||
        raw.length > 16_384
      ) {
        throw new TypeError("Request headers are invalid");
      }
      bytes += name.length + raw.length;
      result[name.toLowerCase()] = raw;
    }
    if (bytes > 64 * 1024) {
      throw new TypeError("Request headers are too large");
    }
    return result;
  }

  // eslint-disable-next-line class-methods-use-this -- This waits on session-owned helper state passed explicitly.
  private waitForComplete(
    record: SessionRecord,
    pending: PendingRequest,
    signal: AbortSignal
  ): Promise<number> {
    if (signal.aborted || record.closed) {
      return Promise.resolve(0);
    }
    // eslint-disable-next-line promise/avoid-new -- Abort signal must race the helper completion event.
    return new Promise<number>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        resolve(0);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const settleComplete = async () => {
        const status = await pending.promise;
        signal.removeEventListener("abort", onAbort);
        resolve(status);
      };
      void settleComplete();
      if (signal.aborted || record.closed) {
        onAbort();
      }
    });
  }
}

export = AgentProxyCoordinator;
