import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIGURATION, publicConfiguration, validateConfiguration } from "../src/server/config.js";

function configurationFixture(): unknown {
  return structuredClone(DEFAULT_CONFIGURATION);
}

test("accepts the approved default configuration", () => {
  const configuration = validateConfiguration(configurationFixture());

  assert.equal(configuration.app.bindHost, "127.0.0.1");
  assert.equal(configuration.model.name, "gpt-5.6-sol");
  assert.equal(configuration.model.store, false);
  assert.equal(configuration.retention.rawMessageDays, 30);
  assert.equal(configuration.retention.derivedInsightDays, 90);
});

test("rejects a non-loopback bind host", () => {
  const fixture = configurationFixture() as { app: { bindHost: string } };
  fixture.app.bindHost = "0.0.0.0";

  assert.throws(() => validateConfiguration(fixture), /loopback host/);
});

test("rejects plaintext credential configuration", () => {
  const fixture = configurationFixture() as { model: { credentialRef: string } };
  fixture.model.credentialRef = "plain-text-secret";

  assert.throws(() => validateConfiguration(fixture), /os-keychain reference/);
});

test("rejects unsupported fields so credentials cannot hide in configuration", () => {
  const fixture = configurationFixture() as { model: Record<string, unknown> };
  fixture.model.apiKey = "CANARY_PLAINTEXT_SECRET";

  assert.throws(() => validateConfiguration(fixture), /model contains unsupported fields: apiKey/);
});

test("rejects any attempt to enable model response storage", () => {
  const fixture = configurationFixture() as { model: { store: boolean } };
  fixture.model.store = true;

  assert.throws(() => validateConfiguration(fixture), /model.store must be false/);
});

test("rejects Webex write scopes and non-loopback OAuth callbacks", () => {
  const writeScopeFixture = configurationFixture() as { webex: { scopes: string[] } };
  writeScopeFixture.webex.scopes = [...writeScopeFixture.webex.scopes, "spark:messages_write"];
  assert.throws(() => validateConfiguration(writeScopeFixture), /approved read-only scopes/);

  const callbackFixture = configurationFixture() as { webex: { oauthRedirectUri: string } };
  callbackFixture.webex.oauthRedirectUri = "https://attacker.example/oauth/webex/callback";
  assert.throws(() => validateConfiguration(callbackFixture), /loopback service callback/);
});

test("public configuration cannot expose credential references", () => {
  const publicView = publicConfiguration(DEFAULT_CONFIGURATION);
  const serialized = JSON.stringify(publicView);

  assert.equal(serialized.includes("credential"), false);
  assert.equal(publicView.externalWritesEnabled, false);
  assert.equal(publicView.backgroundServiceEnabled, false);
  assert.equal(publicView.directMessagesIncluded, true);
});
