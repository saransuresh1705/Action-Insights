import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { DEFAULT_CONFIGURATION } from "../src/server/config.js";
import { assertLoopbackHost, createApplicationServer } from "../src/server/http-server.js";
import { SafeLogger } from "../src/server/safe-logger.js";
import type { AnalysisFacade, CollectionFacade, WebexFacade } from "../src/server/http-server.js";

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
    async listSpaces() {
      return {
        spaces: [],
        retrievedAt: "2026-09-12T00:00:00.000Z",
        activityWindowDays: 30,
        totalSpaces: 0,
        excludedSpaces: 0,
      };
    },
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

test("updates the catalog activity window through the protected local configuration API", async (context) => {
  let current = structuredClone(DEFAULT_CONFIGURATION);
  const configurationStore = {
    current() { return current; },
    async setCatalogActivityWindowDays(value: unknown) {
      current = {
        ...current,
        webex: { ...current.webex, catalogActivityWindowDays: value as number | null },
      };
      return current;
    },
  };
  const server = createApplicationServer(DEFAULT_CONFIGURATION, {
    publicDirectory: resolve(process.cwd(), "public"),
    sessionToken: "configuration-session-token",
    configurationStore,
    logger: new SafeLogger(() => undefined),
  });
  context.after(() => server.close());
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {
    Cookie: "action_insights_session=configuration-session-token",
    "X-Action-Insights-Request": "1",
    "Content-Type": "application/json",
  };

  const update = await fetch(`${baseUrl}/api/configuration/catalog-activity-window`, {
    method: "POST",
    headers,
    body: JSON.stringify({ activityWindowDays: null }),
  });
  assert.equal(update.status, 200);
  assert.equal(((await update.json()) as { catalogActivityWindowDays: number | null }).catalogActivityWindowDays, null);

  const invalid = await fetch(`${baseUrl}/api/configuration/catalog-activity-window`, {
    method: "POST",
    headers,
    body: JSON.stringify({ activityWindowDays: 0 }),
  });
  assert.equal(invalid.status, 400);
});

test("protects analysis acknowledgement and local action feedback routes", async (context) => {
  let acknowledged = false;
  let receivedStatus = "";
  const analysis: AnalysisFacade = {
    async readiness() {
      return {
        modelName: "gpt-5.6-sol", credentialConfigured: true,
        retentionAcknowledged: acknowledged, enabled: acknowledged,
        disclosureUrl: "https://developers.openai.com/api/docs/guides/your-data",
      };
    },
    acknowledgeRetention() { acknowledged = true; },
    list() { return { summaries: [], actions: [] }; },
    updateAction(id, input) {
      receivedStatus = input.status ?? "";
      if (id !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") return null;
      return {
        id, roomId: "room", spaceTitle: "Space", collectionNames: [], category: "Reply required",
        status: input.status ?? "New", confidence: "High", confidenceScore: 0.9, rationale: "Reason",
        owner: "You", dueDateInferred: false, urgency: "normal", dependencies: [], recommendedNextStep: "Reply",
        sourceMessageId: "message", sourceAuthor: "Participant", sourceTimestamp: "2026-09-12T00:00:00.000Z",
        sourceSnippet: "Snippet", sourceUrl: "webexteams://im?space=room", compatibilityWarning: "Warning",
        contextPreview: "Context", evidenceMessageIds: ["message"], modelName: "gpt-5.6-sol",
        analyzedAt: "2026-09-12T00:00:00.000Z", stale: false,
      };
    },
  };
  const server = createApplicationServer(DEFAULT_CONFIGURATION, {
    publicDirectory: resolve(process.cwd(), "public"), sessionToken: "analysis-session-token",
    analysis, logger: new SafeLogger(() => undefined),
  });
  context.after(() => server.close());
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cookie = "action_insights_session=analysis-session-token";
  const readiness = await fetch(`${baseUrl}/api/analysis/readiness`, { headers: { Cookie: cookie } });
  assert.equal(readiness.status, 200);
  assert.equal(((await readiness.json()) as { enabled: boolean }).enabled, false);
  const acknowledge = await fetch(`${baseUrl}/api/analysis/acknowledgement`, {
    method: "POST", headers: { Cookie: cookie, "X-Action-Insights-Request": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ accepted: true }),
  });
  assert.equal(acknowledge.status, 200);
  assert.equal(((await acknowledge.json()) as { enabled: boolean }).enabled, true);
  const feedback = await fetch(`${baseUrl}/api/actions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: "POST", headers: { Cookie: cookie, "X-Action-Insights-Request": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Reviewed" }),
  });
  assert.equal(feedback.status, 200);
  assert.equal(receivedStatus, "Reviewed");
});
