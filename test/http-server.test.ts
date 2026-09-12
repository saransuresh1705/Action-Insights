import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { DEFAULT_CONFIGURATION } from "../src/server/config.js";
import { assertLoopbackHost, createApplicationServer } from "../src/server/http-server.js";
import { SafeLogger } from "../src/server/safe-logger.js";
import type { CollectionFacade, WebexFacade } from "../src/server/http-server.js";

const collectionId = "11111111-1111-4111-8111-111111111111";
const collections: CollectionFacade = {
  list() { return { collections: [] }; },
  create(input) {
    return {
      id: collectionId,
      name: input.name,
      description: input.description ?? "",
      spaceIds: [],
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
  },
  replaceSpaces(_id, input) {
    return {
      id: collectionId,
      name: "Test",
      description: "",
      spaceIds: input.spaceIds,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
  },
};

test("refuses non-loopback server binding", () => {
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /Refusing to bind/);
  assert.doesNotThrow(() => assertLoopbackHost("127.0.0.1"));
});

test("serves the shell securely and protects local API routes with a session", async (context) => {
  const logLines: string[] = [];
  const server = createApplicationServer(DEFAULT_CONFIGURATION, {
    publicDirectory: resolve(process.cwd(), "public"),
    version: "test",
    sessionToken: "test-session-token",
    logger: new SafeLogger((line) => logLines.push(line)),
  });
  context.after(() => server.close());

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/api/health`);
  assert.equal(unauthorized.status, 401);

  const shell = await fetch(baseUrl);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /Webex Action Insights/);
  assert.match(shell.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(shell.headers.get("x-frame-options"), "DENY");
  const cookie = shell.headers.get("set-cookie")?.split(";", 1)[0];
  assert.equal(cookie, "action_insights_session=test-session-token");

  const health = await fetch(`${baseUrl}/api/health`, { headers: { Cookie: cookie ?? "" } });
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as Record<string, unknown>;
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.service, "Webex Action Insights");
  assert.equal(healthBody.version, "test");
  assert.equal(typeof healthBody.now, "string");

  const configuration = await fetch(`${baseUrl}/api/configuration`, { headers: { Cookie: cookie ?? "" } });
  assert.equal(configuration.status, 200);
  const publicView = (await configuration.json()) as Record<string, unknown>;
  assert.equal(publicView.externalWritesEnabled, false);
  assert.equal("credentialRef" in publicView, false);

  assert.equal(logLines.some((line) => line.includes("test-session-token")), false);
});

test("protects Webex actions with the local session and explicit action header", async (context) => {
  let authorizationCompleted = false;
  const webex: WebexFacade = {
    async beginAuthorization() { return "https://webexapis.com/v1/authorize?state=safe"; },
    async completeAuthorization(code, state) { authorizationCompleted = code === "code-canary" && state === "state-canary"; },
    async status() { return { configured: true, connected: false, tokenHealth: "disconnected", grantedScopes: [] }; },
    async listSpaces() { return { spaces: [], retrievedAt: "2026-09-12T00:00:00.000Z" }; },
    async disconnect() {},
  };
  const logLines: string[] = [];
  const server = createApplicationServer(DEFAULT_CONFIGURATION, {
    publicDirectory: resolve(process.cwd(), "public"),
    sessionToken: "webex-session-token",
    logger: new SafeLogger((line) => logLines.push(line)),
    webex,
    collections,
  });
  context.after(() => server.close());
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cookie = `action_insights_session=webex-session-token`;

  const missingActionHeader = await fetch(`${baseUrl}/api/webex/oauth/start`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(missingActionHeader.status, 403);

  const start = await fetch(`${baseUrl}/api/webex/oauth/start`, {
    method: "POST",
    headers: { Cookie: cookie, "X-Action-Insights-Request": "1" },
  });
  assert.equal(start.status, 200);
  assert.deepEqual(await start.json(), { authorizationUrl: "https://webexapis.com/v1/authorize?state=safe" });

  const callback = await fetch(`${baseUrl}/oauth/webex/callback?code=code-canary&state=state-canary`);
  assert.equal(callback.status, 200);
  assert.equal(authorizationCompleted, true);
  assert.equal(logLines.some((line) => line.includes("code-canary") || line.includes("state-canary")), false);

  const createCollection = await fetch(`${baseUrl}/api/collections`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-Action-Insights-Request": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "My priorities" }),
  });
  assert.equal(createCollection.status, 201);
  assert.equal(((await createCollection.json()) as { name: string }).name, "My priorities");

  const saveSpaces = await fetch(`${baseUrl}/api/collections/${collectionId}/spaces`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-Action-Insights-Request": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ spaceIds: ["room-1"] }),
  });
  assert.equal(saveSpaces.status, 200);
  assert.deepEqual(((await saveSpaces.json()) as { spaceIds: string[] }).spaceIds, ["room-1"]);
});
