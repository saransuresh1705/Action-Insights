import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { DEFAULT_CONFIGURATION } from "../src/server/config.js";
import { assertLoopbackHost, createApplicationServer } from "../src/server/http-server.js";
import { SafeLogger } from "../src/server/safe-logger.js";

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
