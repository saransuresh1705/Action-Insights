import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { APP_NAME, type ApiError, type HealthResponse } from "../shared/contracts.js";
import { publicConfiguration, type AppConfiguration } from "./config.js";
import { SafeLogger } from "./safe-logger.js";

const SESSION_COOKIE = "action_insights_session";
const STATIC_ROUTES = new Map([
  ["/", "index.html"],
  ["/styles.css", "styles.css"],
  ["/client/app.js", "client/app.js"],
]);

export interface ServerOptions {
  readonly publicDirectory: string;
  readonly version?: string;
  readonly logger?: SafeLogger;
  readonly sessionToken?: string;
}

export function createApplicationServer(configuration: AppConfiguration, options: ServerOptions): Server {
  const logger = options.logger ?? new SafeLogger();
  const sessionToken = options.sessionToken ?? randomBytes(32).toString("base64url");
  const version = options.version ?? "0.1.0";

  return createServer(async (request, response) => {
    const requestId = randomBytes(8).toString("hex");
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://localhost").pathname;

    applySecurityHeaders(response);

    try {
      if (method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" } satisfies ApiError);
        logger.info("http_request", { requestId, method, route: normalizedRoute(path), httpStatus: 405 });
        return;
      }

      const staticFile = STATIC_ROUTES.get(path);
      if (staticFile !== undefined) {
        if (path === "/") {
          response.setHeader(
            "Set-Cookie",
            `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
          );
        }
        await sendStatic(response, join(options.publicDirectory, staticFile));
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (!hasValidSession(request, sessionToken)) {
        sendJson(response, 401, { error: "Local session required" } satisfies ApiError);
        logger.info("http_request", { requestId, method, route: normalizedRoute(path), httpStatus: 401 });
        return;
      }

      if (path === "/api/health") {
        sendJson(response, 200, {
          status: "ok",
          service: APP_NAME,
          version,
          now: new Date().toISOString(),
        } satisfies HealthResponse);
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (path === "/api/configuration") {
        sendJson(response, 200, publicConfiguration(configuration));
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      sendJson(response, 404, { error: "Not found" } satisfies ApiError);
      logger.info("http_request", { requestId, method, route: normalizedRoute(path), httpStatus: 404 });
    } catch (error: unknown) {
      const errorCode = error instanceof Error ? error.name : "UnknownError";
      sendJson(response, 500, { error: "Internal server error" } satisfies ApiError);
      logger.error("http_request_failed", {
        requestId,
        method,
        route: normalizedRoute(path),
        httpStatus: 500,
        errorCode,
      });
    }
  });
}

export function assertLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("Refusing to bind the application service to a non-loopback host");
  }
}

function hasValidSession(request: IncomingMessage, expectedToken: string): boolean {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) {
    return false;
  }
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === SESSION_COOKIE)?.[1];

  if (token === undefined) {
    return false;
  }
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function sendStatic(response: ServerResponse, filePath: string): Promise<void> {
  const contents = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType(filePath));
  response.end(contents);
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "text/html; charset=utf-8";
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function normalizedRoute(path: string): string {
  return path.startsWith("/api/") ? "/api/unknown" : "/unknown";
}
