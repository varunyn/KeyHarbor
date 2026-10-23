import assert from "node:assert/strict";
import { getEventListeners, once } from "node:events";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import tls from "node:tls";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type { AgentProxyApprover } from "../src/modules/agent-proxy-contracts";

const AgentProxyCoordinator = require("../src/modules/agent-proxy-coordinator");
const VaultManager = require("../src/modules/vault-manager");
const VaultRecoveryStore = require("../src/modules/vault-recovery-store");
const VaultSession = require("../src/modules/vault-session");
const HttpServer = require("../src/modules/http-server");
const { getAppDataPath } = require("../src/modules/app-data-path");
const { requestThroughAgentProxy } = require("../cli/agent-proxy-client");

const PASSWORD = "agent-proxy-test-password";
const UPSTREAM_CA = `-----BEGIN CERTIFICATE-----
MIIDHjCCAgagAwIBAgIUHmDUT1IIb7uap0LpuoUQdzPcZZEwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTAxMzIyMDMxMloXDTM2MTAx
MDIyMDMxMlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAqKJhS/DaNTJPK1FIplbRvAyhVoaqFaAIKs8wUz7ReTIK
ipTH1prrH96kLErPNIqx2b43IyHQ9/fajVgMQoywpcDIcTs/XbKACb8mwHeZRAAK
kYP7BPCxK3JkqdofcXpnaaITy+tXJEmM7xlIRQ2+G/X8fRpvji0x9V7XUxnpnHa+
UMOc1JyTT7tcXOSojpjVs8Saq2zvyl0wobujs9ned5SNjS2HJfmk+ejgklowbLBo
3mJT+Dc9wCTAGaXZ5dRSxd2HHW2ExexadyQVrhDt4Re0XBZYTrgfpbHfmyoN9s9i
TLjTTf7S1rPXjoKJ3Jk50HH5N1O3K5C7wHBpDAHMrwIDAQABo2gwZjAdBgNVHQ4E
FgQUDNMGDRxKBIkXjLuj7WvHl5uzMc4wDwYDVR0RBAgwBocEfwAAATAPBgNVHRMB
Af8EBTADAQH/MA4GA1UdDwEB/wQEAwICpDATBgNVHSUEDDAKBggrBgEFBQcDATAN
BgkqhkiG9w0BAQsFAAOCAQEAOvVBVAZ6z/Zw/ehs6oZoMNI55aZHpHgxPWfROx1z
FVBtg/ElEFQ+cFYNIXbYmB4hjRcxnM5zagVUkbhrq+ZuvLLOC3hAwQbxtFDQ8+h9
8jIiXBJm2yorPGxruDYEcCdvpRkuCfe1H0ahI/i4b4jy4KveZrKNvHbB/ly615AV
laFjL0dJw6YHXK0WjznpK4oRj8+C/spTyYlu3KQ4iMRhIcxtf6vvfOn3dl4isEex
xn92+NsqAMpk5q6x0wofaQL1l+lBZZDCQg/1j4qwfhdJqyWTJrwsKk+Sl/C8+aDn
tzc6eU7Hbp9DLlS5svMtM36WHzR99iybOdXt4Ls70jQ/ng==
-----END CERTIFICATE-----`;
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCoomFL8No1Mk8r
UUimVtG8DKFWhqoVoAgqzzBTPtF5MgqKlMfWmusf3qQsSs80irHZvjcjIdD399qN
WAxCjLClwMhxOz9dsoAJvybAd5lEAAqRg/sE8LErcmSp2h9xemdpohPL61ckSYzv
GUhFDb4b9fx9Gm+OLTH1XtdTGemcdr5Qw5zUnJNPu1xc5KiOmNWzxJqrbO/KXTCh
u6Oz2d53lI2NLYcl+aT56OCSWjBssGjeYlP4Nz3AJMAZpdnl1FLF3YcdbYTF7Fp3
JBWuEO3hF7RcFlhOuB+lsd+bKg32z2JMuNNN/tLWs9eOgoncmTnQcfk3U7crkLvA
cGkMAcyvAgMBAAECggEAAf3Q7J8wDy0NimQJx3UbHUKYu9XbMZcKp77Eo3lRocgO
4vQsqC1vIeHumVtOtzintO/Gj5WzLJavvEoneQGIbjsopeBYh48S/yjyNwUXIOOk
wmcTUnAjI66LcYAoRdsiJ4JL31z1y/erukPj1hNoFzLSt8ykvdrCr8CzmEdnKA2F
Py+1F1vNFnG3Y8wlPekeNuyReCitXIxX4Rx1OAYWAoWGGcAn9fPya/Szi8JPgr1c
WWyjolvwuKDWYRQRJklkgjuYjQM8DQu1xmhKXu4LjhVsVESlCVi5iCzWi/lQ1Sgg
akIiMwLmtFqkA+h7RH+xwj0HJLi7iocssMNH9vs76QKBgQDkgeBXyT1gtzp6z4jk
J1BLSSWJcKOSAulhP0W+jxw/a/oLRdHAK3rQAgpAwkW4QBo/CG5kHIIjd8XlxyLD
KKq/dfPlZvmv/Zes2YIxpe6oyZKmAeeaont2a336loWx3I3ZNTgtGD487e9S0mZp
ghmp+bDfVJ647MRdoI+mVySI0wKBgQC87GOAMukrhWpFNjBgSaWmfIn9CF3Z/sXX
YKXbmL1z4DTZ77rZ0+ugL/8sSO/mqoa+zOpnbJVinKh0WNqWsVvfczkelvFcYlf/
d03uz6/KCNDKsZ/rv0eyBJsbpD6YDUZi/Syr4S8L4MszY4EIIpRMpuEHKWwnFH2m
pZTSJm0DNQKBgDhUvBVoCrV49fWoi7qS5nxov9Qt7GTmStoqWusrJG+OEsoMoDSb
g18b4aMtQTq2ssGvNmd/j6VmtWZ7vNoXgGBKl6GJzSvRfD6kMDBFE5yQdJJwDcRV
IdKDlT7dNIAwOte9Aug6/bzPexwTuiNwaxs37p5fofE8jPv3xPHgsaT5AoGBAKND
tglH9fFCbsA5QD016A2keqtM265UWizyvOK1cKP/Ei102wj79xiL4f0nWwsAO0oQ
VFHkqIR71agWUXEA/OBx9t7Umui3pEyFkbfbi5MRYz6HmihlOVRCXrjYi69jaXyK
RlyTUdD2ByT1zMB3AansXXOO/IQZVSz60015H6QxAoGAbro/DUJx8CMBKsSzGh9N
EE8dbd28YoyeUOyFBMMOU9eCH9xvH7YAq/knqL0A8d3eVqtx0kA7azPNaXg7Uujb
tGV02woy1EkVtP7RUe9kqSuoCSe0+OzyiLtgCwhV2f/K9rz49GUSpUfAazcZ0JeV
XRcUDBo962Z0rCVlQOJYhe8=
-----END PRIVATE KEY-----`;

const helperPath = () => {
  const architecture = process.arch === "x64" ? "x64" : "arm64";
  const binary =
    process.platform === "win32"
      ? "keyharbor-agent-proxy.exe"
      : "keyharbor-agent-proxy";
  return path.resolve(
    __dirname,
    "../../native/agent-proxy/bin",
    `${process.platform}-${architecture}`,
    binary
  );
};

const createFixture = async (
  t: { after: (callback: () => unknown) => void },
  onRequest: (
    authorization: string | undefined,
    url: string | undefined
  ) => void = () => {},
  approve: AgentProxyApprover = () => Promise.resolve({ approved: true })
) => {
  const upstream = https.createServer(
    { cert: UPSTREAM_CA, key: PRIVATE_KEY },
    (request, response) => {
      const { authorization } = request.headers;
      onRequest(authorization, request.url);
      response.setHeader("content-type", "text/plain");
      response.setHeader("x-reflected-credential", authorization ?? "none");
      const bareCredential =
        authorization?.replace(/^Bearer\s+/u, "") ?? "none";
      response.setHeader("x-reflected-bare-credential", bareCredential);
      response.end(
        `upstream reflected ${authorization ?? "none"} and ${bareCredential}`
      );
    }
  );
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => upstream.close());
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const origin = `https://127.0.0.1:${address.port}`;

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "keyharbor-agent-proxy-")
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const recoveryStore = new VaultRecoveryStore(
    path.join(directory, "recovery")
  );
  const vaultManager = new VaultManager(directory, { recoveryStore });
  vaultManager.init();
  const session = new VaultSession({
    httpIngress: { disableSensitive() {}, enableSensitive() {} },
    logger: { clearEncryptionKey() {}, setEncryptionKey() {} },
    recoveryStore,
    settingsProvider: () => ({ autoLockEnabled: false, diskSyncIntervalMs: 0 }),
    vaultManager,
  });
  await session.open({
    credential: PASSWORD,
    method: "setup",
    reason: "setup",
  });
  await session.withActiveSession(({ activeVault }) => {
    activeVault.createProject("proxy-project");
    const staging = activeVault.createEnvironment("proxy-project", "staging");
    const defaultTarget = activeVault.resolveEnvironmentTarget({
      projectName: "proxy-project",
    });
    activeVault.setSecret(defaultTarget, "api-key", "initial-proxy-secret");
    activeVault.setSecret(defaultTarget, "rotation-key", "before-approval");
    activeVault.setSecret(
      { environmentId: staging.id, projectName: "proxy-project" },
      "api-key",
      "staging-proxy-secret"
    );
    activeVault.setSecret(
      { environmentId: staging.id, projectName: "proxy-project" },
      "staging-only",
      "staging-value"
    );
  });
  const coordinator = new AgentProxyCoordinator({
    approve,
    helperPath: helperPath(),
    session,
  });
  t.after(async () => {
    coordinator.clear();
    await session.close({ reason: "manual" }).catch(() => {});
  });
  return { coordinator, origin, session, vaultManager };
};

const createSession = (
  coordinator: InstanceType<typeof AgentProxyCoordinator>,
  origin: string,
  key = "api-key"
) =>
  coordinator.createSession({
    allowPrivateNetwork: true,
    key,
    origin,
    pathPrefixes: ["/v1"],
    projectName: "proxy-project",
    ttlSeconds: 120,
    upstreamCaCertificate: UPSTREAM_CA,
  });

const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for proxy approval callback");
    }
    // eslint-disable-next-line no-await-in-loop -- Poll for an externally delivered approval callback with a short fixed bound.
    await delay(5);
  }
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  // eslint-disable-next-line promise/avoid-new -- Tests need to settle the real approval callback from the test body.
  const promise = new Promise<Value>((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

class SocketReader {
  private buffer = Buffer.alloc(0);
  private waiter: (() => void) | undefined;
  private readonly socket: net.Socket | tls.TLSSocket;

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.waiter?.();
    });
  }

  async untilHeader(): Promise<string> {
    await this.until((buffer) => buffer.includes("\r\n\r\n"));
    const end = this.buffer.indexOf("\r\n\r\n") + 4;
    const result = this.buffer.subarray(0, end).toString("latin1");
    this.buffer = this.buffer.subarray(end);
    return result;
  }

  async response(): Promise<string> {
    await this.until((buffer) => buffer.includes("\r\n\r\n"));
    const headerEnd = this.buffer.indexOf("\r\n\r\n") + 4;
    const headers = this.buffer.subarray(0, headerEnd).toString("latin1");
    const contentLength = Number(
      headers.match(/\r\ncontent-length:\s*(?<length>\d+)/iu)?.groups?.length
    );
    let total = headerEnd;
    if (Number.isFinite(contentLength)) {
      total += contentLength;
      await this.until((buffer) => buffer.length >= total);
    } else if (/\r\ntransfer-encoding:\s*chunked/iu.test(headers)) {
      await this.until((buffer) =>
        buffer.subarray(headerEnd).includes("0\r\n\r\n")
      );
      const ending = this.buffer.indexOf("0\r\n\r\n", headerEnd);
      total = ending + 5;
    } else {
      throw new Error("Upstream response did not have a bounded body");
    }
    const result = this.buffer.subarray(0, total).toString("latin1");
    this.buffer = this.buffer.subarray(total);
    return result;
  }

  private async until(predicate: (buffer: Buffer) => boolean): Promise<void> {
    while (!predicate(this.buffer)) {
      const signal = deferred<true>();
      this.waiter = () => signal.resolve(true);
      // eslint-disable-next-line no-await-in-loop -- Continue reading this socket until one complete HTTP response arrives.
      await signal.promise;
      this.waiter = undefined;
    }
  }
}

const openPersistentTunnel = async (
  session: { proxyUrl: string; caCertificate: string },
  origin: string
) => {
  const proxy = new URL(session.proxyUrl);
  const socket = net.connect(Number(proxy.port), proxy.hostname);
  socket.setTimeout(10_000);
  await once(socket, "connect");
  const reader = new SocketReader(socket);
  const credentials = Buffer.from(
    `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
  ).toString("base64");
  const destination = new URL(origin);
  socket.write(
    `CONNECT ${destination.host} HTTP/1.1\r\nHost: ${destination.host}\r\nProxy-Authorization: Basic ${credentials}\r\nConnection: keep-alive\r\n\r\n`
  );
  const connectResponse = await reader.untilHeader();
  assert.match(connectResponse, /^HTTP\/1\.[01] 200\b/u);
  const secure = tls.connect({
    ca: session.caCertificate,
    rejectUnauthorized: true,
    servername: destination.hostname,
    socket,
  });
  secure.setTimeout(10_000);
  await once(secure, "secureConnect");
  return { reader: new SocketReader(secure), secure };
};

// Contract: every frozen HTTPS request must pass the desktop approver before the real helper can dispatch it.
// Credible regressions include tunnel-level approval reuse, stale-secret injection, and reflected credentials escaping upstream filtering.
// Existing client tests only cover proxy refusal; these cases own the real VaultSession/helper boundary and use no child-process test seam.
test("real helper waits for approval on every request over one CONNECT tunnel and filters reflected credentials", async (t) => {
  const upstreamRequests: {
    authorization: string | undefined;
    url: string | undefined;
  }[] = [];
  const useRequests: {
    resolve: (decision: { approved: boolean }) => void;
    request: unknown;
  }[] = [];
  const approvals: string[] = [];
  const fixture = await createFixture(
    t,
    (authorization, url) => upstreamRequests.push({ authorization, url }),
    (request) => {
      approvals.push(request.action);
      if (request.action === "connect") {
        return Promise.resolve({ approved: true });
      }
      const approval = deferred<{ approved: boolean }>();
      useRequests.push({ ...approval, request });
      return approval.promise;
    }
  );
  const operationSignals: AbortSignal[] = [];
  const withActiveSession = fixture.session.withActiveSession.bind(
    fixture.session
  );
  fixture.session.withActiveSession = (operation) =>
    withActiveSession((context) => {
      operationSignals.push(context.signal);
      return operation(context);
    });
  const proxySession = await createSession(fixture.coordinator, fixture.origin);
  const tunnel = await openPersistentTunnel(proxySession, fixture.origin);
  t.after(() => tunnel.secure.destroy());

  const send = async (pathName: string, requestBody = "") => {
    const previousRequests = upstreamRequests.length;
    const method = requestBody ? "POST" : "GET";
    tunnel.secure.write(
      `${method} ${pathName} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${proxySession.placeholder}\r\nContent-Length: ${Buffer.byteLength(requestBody)}\r\nConnection: keep-alive\r\n\r\n${requestBody}`
    );
    await waitFor(() => useRequests.length > 0);
    assert.equal(
      upstreamRequests.length,
      previousRequests,
      "upstream must wait for desktop approval"
    );
    const approval = useRequests.shift();
    assert.ok(approval);
    if (requestBody) {
      assert.equal(typeof approval.request, "object");
      const request = approval.request as { bodyPreview: string; path: string };
      const selectedSecret = "initial-proxy-secret";
      const encodedSecret = encodeURIComponent(selectedSecret);
      const base64Secret = Buffer.from(selectedSecret).toString("base64");
      assert.equal(request.bodyPreview.includes(selectedSecret), false);
      assert.equal(request.bodyPreview.includes(encodedSecret), false);
      assert.equal(request.bodyPreview.includes(base64Secret), false);
      assert.equal(request.bodyPreview.includes("body-token-value"), false);
      assert.match(request.bodyPreview, /\[REDACTED\]/u);
      assert.match(request.path, /repo=main/u);
      assert.match(request.path, /%5BREDACTED%5D=%5BREDACTED%5D/u);
      assert.equal(request.path.includes(selectedSecret), false);
      assert.equal(request.path.includes(encodedSecret), false);
    }
    approval.resolve({ approved: true });
    return tunnel.reader.response();
  };

  const firstResponse = await send("/v1/echo?repo=main");
  assert.match(firstResponse, /^HTTP\/1\.[01] 200\b/mu);
  assert.equal(
    upstreamRequests.at(-1)?.authorization,
    "Bearer initial-proxy-secret"
  );
  assert.equal(firstResponse.includes("initial-proxy-secret"), false);
  assert.equal(
    firstResponse
      .toLowerCase()
      .includes("x-reflected-bare-credential: [redacted]"),
    true
  );
  assert.equal(
    firstResponse
      .toLowerCase()
      .includes("x-reflected-credential: bearer initial-proxy-secret"),
    false
  );
  const secondResponse = await send(
    `/v1/${encodeURIComponent("initial-proxy-secret")}?repo=main&${encodeURIComponent("initial-proxy-secret")}=query-token&token=query-token`,
    JSON.stringify({
      base64: Buffer.from("initial-proxy-secret").toString("base64"),
      encoded: encodeURIComponent("initial-proxy-secret"),
      note: "safe note",
      selected: "initial-proxy-secret",
      token: "body-token-value",
    })
  );
  assert.match(secondResponse, /^HTTP\/1\.[01] 200\b/mu);
  assert.equal(upstreamRequests.length, 2);
  assert.deepEqual(approvals, ["connect", "use", "use"]);
  assert.ok(operationSignals.length >= 3);
  assert.ok(
    operationSignals.every(
      (signal) => getEventListeners(signal, "abort").length === 0
    ),
    "completed operations must release their abort listeners"
  );
});

test("denial and a credential rotated during approval never dispatch upstream", async (t) => {
  let upstreamCount = 0;
  let releaseApproval: ((decision: { approved: boolean }) => void) | undefined;
  let approvalStarted = false;
  const fixture = await createFixture(
    t,
    () => {
      upstreamCount += 1;
    },
    (request) => {
      if (request.action === "connect") {
        return Promise.resolve({ approved: true });
      }
      approvalStarted = true;
      const approval = deferred<{ approved: boolean }>();
      releaseApproval = approval.resolve;
      return approval.promise;
    }
  );
  const proxySession = await createSession(fixture.coordinator, fixture.origin);
  const deniedRequest = requestThroughAgentProxy({
    caCertificate: proxySession.caCertificate,
    method: "GET",
    origin: fixture.origin,
    path: "/v1/echo",
    proxyUrl: proxySession.proxyUrl,
  });
  await waitFor(() => approvalStarted);
  releaseApproval?.({ approved: false });
  const deniedResponse = await deniedRequest;
  assert.equal(deniedResponse.status, 403);
  assert.equal(upstreamCount, 0);

  approvalStarted = false;
  const staleRequest = requestThroughAgentProxy({
    caCertificate: proxySession.caCertificate,
    method: "GET",
    origin: fixture.origin,
    path: "/v1/echo",
    proxyUrl: proxySession.proxyUrl,
  });
  await waitFor(() => approvalStarted);
  await fixture.session.withActiveSession(({ activeVault }) => {
    const target = activeVault.resolveEnvironmentTarget({
      projectName: "proxy-project",
    });
    activeVault.setSecret(target, "api-key", "rotated-during-approval");
  });
  releaseApproval?.({ approved: true });
  const staleResponse = await staleRequest;
  assert.equal(staleResponse.status, 403);
  assert.equal(upstreamCount, 0);
  fixture.coordinator.clear();
});

test("default Environment resolution is stable and missing keys do not fall back", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    createSession(fixture.coordinator, fixture.origin, "staging-only")
  );
  await fixture.session.withActiveSession(({ activeVault }) => {
    const staging = activeVault
      .getEnvironments("proxy-project")
      .find((environment) => environment.name === "staging");
    assert.ok(staging);
    activeVault.setDefaultEnvironment("proxy-project", staging.id);
  });
  const proxySession = await createSession(fixture.coordinator, fixture.origin);
  assert.equal(proxySession.environmentName, "staging");
  fixture.coordinator.close(proxySession.sessionId);
  const stagingOnly = await createSession(
    fixture.coordinator,
    fixture.origin,
    "staging-only"
  );
  assert.equal(stagingOnly.environmentName, "staging");
  fixture.coordinator.close(stagingOnly.sessionId);
});

test("helper rejects unauthorized origins and clearing the coordinator revokes a live session", async (t) => {
  let upstreamRequests = 0;
  const fixture = await createFixture(t, () => {
    upstreamRequests += 1;
  });
  const proxySession = await createSession(fixture.coordinator, fixture.origin);
  await assert.rejects(
    requestThroughAgentProxy({
      caCertificate: proxySession.caCertificate,
      method: "GET",
      origin: "https://example.invalid",
      path: "/v1/echo",
      proxyUrl: proxySession.proxyUrl,
    }),
    /Approved proxy tunnel was refused\./u
  );
  assert.equal(upstreamRequests, 0);
  fixture.coordinator.clear();
  await assert.rejects(
    requestThroughAgentProxy({
      caCertificate: proxySession.caCertificate,
      method: "GET",
      origin: fixture.origin,
      path: "/v1/echo",
      proxyUrl: proxySession.proxyUrl,
    })
  );
});

test("mutable create input cannot add private-network or custom-CA trust after approval", async (t) => {
  let releaseConnection:
    | ((decision: { approved: boolean }) => void)
    | undefined;
  let connectRequest: Parameters<AgentProxyApprover>[0] | undefined;
  let upstreamRequests = 0;
  const fixture = await createFixture(
    t,
    () => {
      upstreamRequests += 1;
    },
    (request) => {
      if (request.action === "connect") {
        connectRequest = request;
        const approval = deferred<{ approved: boolean }>();
        releaseConnection = approval.resolve;
        return approval.promise;
      }
      return Promise.resolve({ approved: true });
    }
  );
  const input = {
    allowPrivateNetwork: false,
    key: "api-key",
    methods: ["GET"],
    origin: fixture.origin,
    pathPrefixes: ["/v1"],
    projectName: "proxy-project",
    ttlSeconds: 120,
  };
  const creating = fixture.coordinator.createSession(input);
  await waitFor(() => releaseConnection !== undefined);
  input.allowPrivateNetwork = true;
  Object.assign(input, { upstreamCaCertificate: UPSTREAM_CA });
  releaseConnection?.({ approved: true });
  const proxySession = await creating;
  assert.ok(connectRequest);
  assert.equal(connectRequest.allowPrivateNetwork, undefined);
  assert.equal(connectRequest.customTrust, undefined);
  const response = await requestThroughAgentProxy({
    caCertificate: proxySession.caCertificate,
    method: "GET",
    origin: fixture.origin,
    path: "/v1/echo",
    proxyUrl: proxySession.proxyUrl,
  });
  assert.equal(response.status, 502);
  assert.equal(upstreamRequests, 0);
});

test("session cancellation settles an unresponsive approval immediately", async (t) => {
  let approvalSignal: AbortSignal | undefined;
  const hangingApproval = deferred<{ approved: boolean }>();
  const fixture = await createFixture(t, undefined, (_request, signal) => {
    approvalSignal = signal;
    return hangingApproval.promise;
  });
  const creating = fixture.coordinator.createSession({
    key: "api-key",
    origin: fixture.origin,
    projectName: "proxy-project",
  });
  await waitFor(() => approvalSignal !== undefined);
  const closing = fixture.session.close({ reason: "manual" });
  await assert.rejects(creating, { name: "AbortError" });
  assert.equal(approvalSignal?.aborted, true);
  await closing;
});

test(
  "secretless MCP completes after both approvals exceed the old 30-second cutoff",
  { timeout: 90_000 },
  async (t) => {
    let upstreamCount = 0;
    const approvals: string[] = [];
    const fixture = await createFixture(
      t,
      () => {
        upstreamCount += 1;
      },
      async (request, signal) => {
        approvals.push(request.action);
        await delay(31_000, undefined, { signal });
        assert.equal(upstreamCount, 0, "no dispatch before both decisions");
        return { approved: true };
      }
    );
    const server = new HttpServer(fixture.vaultManager, null, fixture.session);
    server.bindAgentProxy(fixture.coordinator);
    const serverInfoPath = path.join(getAppDataPath(), "server-info.json");
    const previousServerInfo = fs.existsSync(serverInfoPath)
      ? fs.readFileSync(serverInfoPath)
      : undefined;
    const previousMode = fs.existsSync(serverInfoPath)
      ? fs.statSync(serverInfoPath).mode % 0o1000
      : undefined;
    await server.start();
    const client = new Client({
      name: "approval-timeout-regression",
      version: "1.0.0",
    });
    t.after(async () => {
      await client.close();
      await server.stop();
      if (previousServerInfo) {
        fs.writeFileSync(serverInfoPath, previousServerInfo);
        if (previousMode !== undefined) {
          fs.chmodSync(serverInfoPath, previousMode);
        }
      } else {
        fs.rmSync(serverInfoPath, { force: true });
      }
    });
    await client.connect(
      new StdioClientTransport({
        args: [
          path.resolve(__dirname, "../cli/keyharbor-mcp.mjs"),
          "--secretless",
        ],
        command: process.execPath,
        stderr: "ignore",
      })
    );
    const result = await client.callTool(
      {
        arguments: {
          allowPrivateNetwork: true,
          key: "api-key",
          method: "GET",
          origin: fixture.origin,
          path: "/v1/echo",
          projectName: "proxy-project",
          upstreamCaCertificate: UPSTREAM_CA,
        },
        name: "authenticated_request",
      },
      { timeout: 300_000 }
    );
    assert.notEqual(result.isError, true);
    assert.equal((result.structuredContent as { status: number }).status, 200);
    assert.equal(upstreamCount, 1);
    assert.deepEqual(approvals, ["connect", "use"]);
    assert.equal(
      JSON.stringify(result).includes("initial-proxy-secret"),
      false
    );
  }
);

test("issued proxy bearer cannot authenticate raw HTTP bridge actions", async (t) => {
  const fixture = await createFixture(t);
  const server = new HttpServer(fixture.vaultManager, null, fixture.session);
  server.bindAgentProxy(fixture.coordinator);
  const serverInfoPath = path.join(getAppDataPath(), "server-info.json");
  const previousServerInfo = fs.existsSync(serverInfoPath)
    ? fs.readFileSync(serverInfoPath)
    : undefined;
  const previousServerInfoMode = fs.existsSync(serverInfoPath)
    ? fs.statSync(serverInfoPath).mode % 0o1000
    : undefined;
  const connection = await server.start();
  let sessionId = "";
  try {
    const baseUrl = `http://${connection.host}:${connection.port}`;
    const bridgeRequest = (
      authorization: string,
      action: string,
      data: object
    ) =>
      fetch(baseUrl, {
        body: JSON.stringify({ action, data }),
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
    const createResponse = await bridgeRequest(
      `Bearer ${connection.authToken}`,
      "createAgentSession",
      {
        allowPrivateNetwork: true,
        key: "api-key",
        origin: fixture.origin,
        pathPrefixes: ["/v1"],
        projectName: "proxy-project",
        ttlSeconds: 120,
        upstreamCaCertificate: UPSTREAM_CA,
      }
    );
    assert.equal(createResponse.status, 200);
    const {
      data: { proxyUrl, sessionId: issuedSessionId },
      success,
    } = (await createResponse.json()) as {
      data: { proxyUrl: string; sessionId: string };
      success: boolean;
    };
    assert.equal(success, true);
    sessionId = issuedSessionId;
    const proxyToken = new URL(proxyUrl).username;
    const rawResponse = await bridgeRequest(
      `Bearer ${proxyToken}`,
      "getSecret",
      { key: "api-key", projectName: "proxy-project" }
    );
    assert.equal(rawResponse.status, 401);
    assert.doesNotMatch(await rawResponse.text(), /initial-proxy-secret/u);
    const closeResponse = await bridgeRequest(
      `Bearer ${connection.authToken}`,
      "closeAgentSession",
      { sessionId }
    );
    assert.equal(closeResponse.status, 200);
  } finally {
    if (sessionId) {
      fixture.coordinator.close(sessionId);
    }
    await server.stop();
    if (previousServerInfo) {
      fs.writeFileSync(serverInfoPath, previousServerInfo);
      if (previousServerInfoMode !== undefined) {
        fs.chmodSync(serverInfoPath, previousServerInfoMode);
      }
    } else {
      fs.rmSync(serverInfoPath, { force: true });
    }
  }
});
