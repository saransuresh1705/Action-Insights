import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import {
  APP_NAME,
  APP_VERSION,
  type ApiError,
  type HealthResponse,
  type ScanStatus,
  type SchedulerStatus,
  type WatchedCollectionCatalog,
  type WatchedCollectionView,
  type WebexConnectionStatus,
  type WebexSpaceCatalog,
} from "../shared/contracts.js";
import { publicConfiguration, type AppConfiguration } from "./config.js";
import { SafeLogger } from "./safe-logger.js";

const SESSION_COOKIE = "action_insights_session";
const ACTION_REQUEST_HEADER = "x-action-insights-request";
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
  readonly webex?: WebexFacade;
  readonly collections?: CollectionFacade;
  readonly scans?: ScanFacade;
  readonly scheduler?: SchedulerFacade;
  readonly configurationStore?: ConfigurationFacade;
}

export interface ConfigurationFacade {
  current(): AppConfiguration;
  setCatalogActivityWindowDays(value: unknown): Promise<AppConfiguration>;
}

export interface WebexFacade {
  beginAuthorization(): Promise<string>;
  completeAuthorization(code: string, state: string): Promise<void>;
  status(): Promise<WebexConnectionStatus>;
  listSpaces(): Promise<WebexSpaceCatalog>;
  disconnect(): Promise<void>;
}

export interface CollectionFacade {
  list(): WatchedCollectionCatalog;
  create(input: { readonly name: string; readonly description?: string }): WatchedCollectionView;
  replaceSpaces(collectionId: string, input: { readonly spaceIds: readonly string[] }): WatchedCollectionView;
}

export interface ScanFacade {
  status(): ScanStatus;
  start(): ScanStatus;
  cancel(): ScanStatus;
}

export interface SchedulerFacade {
  status(): SchedulerStatus;
}

export function createApplicationServer(configuration: AppConfiguration, options: ServerOptions): Server {
  const logger = options.logger ?? new SafeLogger();
  const sessionToken = options.sessionToken ?? randomBytes(32).toString("base64url");
  const version = options.version ?? APP_VERSION;

  return createServer(async (request, response) => {
    const requestId = randomBytes(8).toString("hex");
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const path = requestUrl.pathname;

    applySecurityHeaders(response);

    try {
      if (method === "GET" && path === "/oauth/webex/callback") {
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        if (code === null || state === null || options.webex === undefined) {
          sendOAuthResult(response, false);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 400 });
          return;
        }
        try {
          await options.webex.completeAuthorization(code, state);
          sendOAuthResult(response, true);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        } catch (error: unknown) {
          sendOAuthResult(response, false);
          logger.error("http_request_failed", {
            requestId,
            method,
            route: path,
            httpStatus: 400,
            errorCode: error instanceof Error ? error.name : "UnknownError",
          });
        }
        return;
      }

      const staticFile = STATIC_ROUTES.get(path);
      if (method === "GET" && staticFile !== undefined) {
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

      if (method === "POST" && request.headers[ACTION_REQUEST_HEADER] !== "1") {
        sendJson(response, 403, { error: "Action request header required" } satisfies ApiError);
        logger.info("http_request", { requestId, method, route: normalizedRoute(path), httpStatus: 403 });
        return;
      }

      if (method === "GET" && path === "/api/health") {
        sendJson(response, 200, {
          status: "ok",
          service: APP_NAME,
          version,
          now: new Date().toISOString(),
        } satisfies HealthResponse);
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "GET" && path === "/api/configuration") {
        sendJson(response, 200, publicConfiguration(options.configurationStore?.current() ?? configuration));
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "POST" && path === "/api/configuration/catalog-activity-window") {
        if (options.configurationStore === undefined) {
          sendJson(response, 503, { error: "Configuration service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        const body = await readJsonBody(request);
        const value = body.activityWindowDays;
        if (value !== null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 3_650)) {
          sendJson(response, 400, { error: "Activity window must be 1 to 3650 days, or null for all activity" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 400 });
          return;
        }
        const updated = await options.configurationStore.setCatalogActivityWindowDays(value);
        sendJson(response, 200, publicConfiguration(updated));
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "GET" && path === "/api/webex/status") {
        if (options.webex === undefined) {
          sendJson(response, 503, { error: "Webex service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 200, await options.webex.status());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "POST" && path === "/api/webex/oauth/start") {
        if (options.webex === undefined) {
          sendJson(response, 503, { error: "Webex service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        const authorizationUrl = await options.webex.beginAuthorization();
        sendJson(response, 200, { authorizationUrl });
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "GET" && path === "/api/webex/spaces") {
        if (options.webex === undefined) {
          sendJson(response, 503, { error: "Webex service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 200, await options.webex.listSpaces());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "POST" && path === "/api/webex/disconnect") {
        if (options.webex === undefined) {
          sendJson(response, 503, { error: "Webex service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        await options.webex.disconnect();
        response.statusCode = 204;
        response.end();
        logger.info("http_request", { requestId, method, route: path, httpStatus: 204 });
        return;
      }

      if (method === "GET" && path === "/api/collections") {
        if (options.collections === undefined) {
          sendJson(response, 503, { error: "Collection service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 200, options.collections.list());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "POST" && path === "/api/collections") {
        if (options.collections === undefined) {
          sendJson(response, 503, { error: "Collection service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        const body = await readJsonBody(request);
        sendJson(response, 201, options.collections.create(body as { name: string; description?: string }));
        logger.info("http_request", { requestId, method, route: path, httpStatus: 201 });
        return;
      }

      const collectionSpacesMatch = /^\/api\/collections\/([0-9a-f-]{36})\/spaces$/u.exec(path);
      if (method === "POST" && collectionSpacesMatch?.[1] !== undefined) {
        if (options.collections === undefined) {
          sendJson(response, 503, { error: "Collection service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: "/api/collections/:id/spaces", httpStatus: 503 });
          return;
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          options.collections.replaceSpaces(collectionSpacesMatch[1], body as { spaceIds: readonly string[] }),
        );
        logger.info("http_request", {
          requestId,
          method,
          route: "/api/collections/:id/spaces",
          httpStatus: 200,
        });
        return;
      }

      if (method === "GET" && path === "/api/scans/current") {
        if (options.scans === undefined) {
          sendJson(response, 503, { error: "Scan service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 200, options.scans.status());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "POST" && path === "/api/scans") {
        if (options.scans === undefined) {
          sendJson(response, 503, { error: "Scan service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 202, options.scans.start());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 202 });
        return;
      }

      if (method === "POST" && path === "/api/scans/cancel") {
        if (options.scans === undefined) {
          sendJson(response, 503, { error: "Scan service unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 200, options.scans.cancel());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method === "GET" && path === "/api/scheduler/status") {
        if (options.scheduler === undefined) {
          sendJson(response, 503, { error: "Scheduler unavailable" } satisfies ApiError);
          logger.info("http_request", { requestId, method, route: path, httpStatus: 503 });
          return;
        }
        sendJson(response, 200, options.scheduler.status());
        logger.info("http_request", { requestId, method, route: path, httpStatus: 200 });
        return;
      }

      if (method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" } satisfies ApiError);
        logger.info("http_request", { requestId, method, route: normalizedRoute(path), httpStatus: 405 });
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

function sendOAuthResult(response: ServerResponse, successful: boolean): void {
  response.statusCode = successful ? 200 : 400;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Webex connection</title></head><body><main><h1>${successful ? "Webex connected" : "Webex connection failed"}</h1><p>${successful ? "Authorization was stored securely in macOS Keychain." : "The authorization response was invalid or expired."}</p><p><a href="/">Return to Webex Action Insights</a></p></main></body></html>`);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > 65_536) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value = JSON.parse(text) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
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
