import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIGURATION, validateConfiguration } from "../src/server/config.js";
import type { SecretStore } from "../src/server/secrets.js";
import { WebexOAuthService } from "../src/server/webex/oauth.js";

class MemorySecretStore implements SecretStore {
  public value: string | null;
  public readonly writes: string[] = [];

  public constructor(value: string | null) {
    this.value = value;
  }

  public async get(): Promise<string | null> { return this.value; }
  public async set(_reference: string, value: string): Promise<void> { this.value = value; this.writes.push(value); }
  public async delete(): Promise<boolean> { this.value = null; return true; }
}

function configuredApp() {
  const value = structuredClone(DEFAULT_CONFIGURATION) as unknown as { webex: { oauthClientId: string } };
  value.webex.oauthClientId = "approved-client-id";
  return validateConfiguration(value);
}

test("builds a state-protected authorization URL with only approved scopes", async () => {
  const store = new MemorySecretStore("CANARY_CLIENT_SECRET");
  const service = new WebexOAuthService(configuredApp(), store, { randomState: () => "fixed-state" });

  const url = new URL(await service.beginAuthorization());

  assert.equal(url.origin + url.pathname, "https://webexapis.com/v1/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "fixed-state");
  assert.deepEqual(new Set(url.searchParams.get("scope")?.split(" ")), new Set(configuredApp().webex.scopes));
  assert.equal(url.toString().includes("CANARY_CLIENT_SECRET"), false);
});

test("exchanges a valid callback and stores tokens only in the secret store", async () => {
  const store = new MemorySecretStore("CANARY_CLIENT_SECRET");
  let tokenRequestBody = "";
  const fetchMock: typeof fetch = async (_input, init) => {
    tokenRequestBody = String(init?.body);
    return Response.json({
      access_token: "CANARY_ACCESS_TOKEN",
      expires_in: 3600,
      refresh_token: "CANARY_REFRESH_TOKEN",
      refresh_token_expires_in: 86400,
      scope: "spark:rooms_read spark:messages_read spark:people_read spark:kms",
    });
  };
  const service = new WebexOAuthService(configuredApp(), store, {
    fetch: fetchMock,
    now: () => Date.parse("2026-09-12T10:00:00.000Z"),
    randomState: () => "fixed-state",
  });

  await service.beginAuthorization();
  await service.completeAuthorization("one-time-code", "fixed-state");

  assert.match(tokenRequestBody, /client_secret=CANARY_CLIENT_SECRET/);
  assert.equal(store.writes.length, 1);
  const saved = JSON.parse(store.writes[0] ?? "") as Record<string, unknown>;
  assert.equal(saved.accessToken, "CANARY_ACCESS_TOKEN");
  assert.equal(saved.refreshToken, "CANARY_REFRESH_TOKEN");
  assert.equal(saved.expiresAt, "2026-09-12T11:00:00.000Z");
  await assert.rejects(() => service.completeAuthorization("replay", "fixed-state"), /invalid or expired/);
});

test("disconnect removes tokens while retaining the integration client secret", async () => {
  const store = new MemorySecretStore(JSON.stringify({
    version: 1,
    clientSecret: "CANARY_CLIENT_SECRET",
    accessToken: "CANARY_ACCESS_TOKEN",
    refreshToken: "CANARY_REFRESH_TOKEN",
    expiresAt: "2030-01-01T00:00:00.000Z",
  }));
  const service = new WebexOAuthService(configuredApp(), store);

  await service.disconnect();

  assert.deepEqual(JSON.parse(store.value ?? ""), { version: 1, clientSecret: "CANARY_CLIENT_SECRET" });
});

test("refuses to retain a token carrying a write scope", async () => {
  const store = new MemorySecretStore("CANARY_CLIENT_SECRET");
  const service = new WebexOAuthService(configuredApp(), store, {
    randomState: () => "fixed-state",
    fetch: async () => Response.json({
      access_token: "CANARY_ACCESS_TOKEN",
      expires_in: 3600,
      refresh_token: "CANARY_REFRESH_TOKEN",
      scope: "spark:rooms_read spark:messages_read spark:people_read spark:kms spark:messages_write",
    }),
  });

  await service.beginAuthorization();
  await assert.rejects(
    () => service.completeAuthorization("one-time-code", "fixed-state"),
    /did not grant the approved read-only scope set/,
  );
  assert.equal(store.writes.length, 0);
});
