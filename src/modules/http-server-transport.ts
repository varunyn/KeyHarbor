import type HttpServer = require("./http-server");

import type { IncomingMessage, ServerResponse } from "node:http";
import http = require("node:http");
import crypto = require("node:crypto");
import fs = require("node:fs");
import path = require("node:path");

const { getAppDataPath } = require("./app-data-path");

const SERVER_INFO_PATH = path.join(getAppDataPath(), "server-info.json");

export const httpGenerateAuthToken = () =>
  crypto.randomBytes(32).toString("hex");

// Preserve asynchronous rejection when constructing or binding the server fails.
export const httpStart = async (bridge: HttpServer) =>
  // Adapt the Node server listening/error events into the public Promise API.
  // eslint-disable-next-line promise/avoid-new
  await new Promise<{
    authToken: string;
    host: string;
    port: number;
  }>((resolve, reject) => {
    const server = http.createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        bridge.handleRequest(req, res);
      }
    );
    bridge.server = server;
    server.listen(0, bridge.host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("HTTP server has no bound TCP address"));
        return;
      }
      bridge.port = address.port;
      try {
        fs.mkdirSync(path.dirname(SERVER_INFO_PATH), { recursive: true });
      } catch {
        // Discovery directory creation is best effort; the write below reports any failure.
      }
      try {
        fs.writeFileSync(
          SERVER_INFO_PATH,
          JSON.stringify({
            authToken: bridge.authToken,
            host: bridge.host,
            pid: process.pid,
            port: bridge.port,
          })
        );
        try {
          fs.chmodSync(SERVER_INFO_PATH, 0o600);
        } catch (error) {
          console.error(
            "Failed to set server-info.json permissions:",
            error.message
          );
        }
      } catch (error) {
        console.error("Failed to write server-info.json:", error.message);
      }
      resolve({
        authToken: bridge.authToken,
        host: bridge.host,
        port: bridge.port,
      });
    });
    server.on("error", (error: Error) => {
      reject(error);
    });
  });

// Preserve the Promise-returning shutdown API, including synchronous failures.
export const httpStop = async (bridge: HttpServer): Promise<void> => {
  const { server } = bridge;
  if (server) {
    // Node closes the listening socket through its completion callback.
    // eslint-disable-next-line promise/avoid-new
    return await new Promise<void>((resolve) => {
      server.close(() => {
        try {
          if (fs.existsSync(SERVER_INFO_PATH)) {
            fs.unlinkSync(SERVER_INFO_PATH);
          }
        } catch {
          // Discovery file cleanup is best effort; finish closing the server.
        }
        bridge.server = null;
        bridge.authToken = "";
        bridge.port = 0;
        resolve();
      });
    });
  }
};

export const httpAuthenticateRequest = (
  bridge: HttpServer,
  req: IncomingMessage,
  res: ServerResponse
) => {
  const { authorization: authHeader } = req.headers;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Authorization required", success: false })
    );
    return false;
  }
  const token = authHeader.slice(7);
  const expected = Buffer.from(bridge.authToken || "", "utf-8");
  const received = Buffer.from(token, "utf-8");
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid token", success: false }));
    return false;
  }
  return true;
};

export const httpSetCorsHeaders = (res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export const httpHandleRequest = async (
  bridge: HttpServer,
  req: IncomingMessage,
  res: ServerResponse
) => {
  try {
    bridge.setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed", success: false }));
      return;
    }
    if (!bridge.authenticateRequest(req, res)) {
      return;
    }
    const body = await bridge.parseRequestBody(req);
    const action =
      body && typeof body === "object" && "action" in body
        ? body.action
        : undefined;
    const data =
      body && typeof body === "object" && "data" in body
        ? body.data
        : undefined;
    const result = await bridge.handleAction(action, data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    const statusCode = error?.message === "Request too large" ? 413 : 500;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: error.message,
        success: false,
      })
    );
  }
};

export const httpParseRequestBody = (req: IncomingMessage) =>
  // Request body completion/error events must settle one bounded read.
  // eslint-disable-next-line promise/avoid-new
  new Promise<unknown>((resolve, reject) => {
    let body = "";
    let totalLength = 0;
    // Bound request payloads to 1 MiB.
    const MAX_BODY_SIZE = 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request too large"));
        return;
      }
      body += chunk.toString("utf-8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
