import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigurationStore, DEFAULT_CONFIGURATION, publicConfiguration, validateConfiguration } from "../src/server/config.js";

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
  assert.equal(configuration.webex.catalogActivityWindowDays, 30);
  assert.equal(configuration.connectors.jira.enabled, false);
  assert.equal(configuration.connectors.jira.maxCallsPerAnalysis, 3);
});

test("migrates a missing catalog activity window to 30 days and accepts explicit all activity", () => {
  const fixture = configurationFixture() as { webex: Record<string, unknown> };
  delete fixture.webex.catalogActivityWindowDays;
  assert.equal(validateConfiguration(fixture).webex.catalogActivityWindowDays, 30);

  fixture.webex.catalogActivityWindowDays = null;
  assert.equal(validateConfiguration(fixture).webex.catalogActivityWindowDays, null);
  fixture.webex.catalogActivityWindowDays = 0;
  assert.throws(() => validateConfiguration(fixture), /between 1 and 3650/);
});

test("persists catalog activity settings atomically in the non-secret local configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "action-insights-config-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const path = join(directory, "config.json");
  const store = new ConfigurationStore(path, DEFAULT_CONFIGURATION);

  const updated = await store.setCatalogActivityWindowDays(null);

  assert.equal(updated.webex.catalogActivityWindowDays, null);
  assert.equal(store.current().webex.catalogActivityWindowDays, null);
  const persisted = JSON.parse(await readFile(path, "utf8")) as { webex: Record<string, unknown>; model: Record<string, unknown> };
  assert.equal(persisted.webex.catalogActivityWindowDays, null);
  assert.equal(persisted.model.credentialRef, DEFAULT_CONFIGURATION.model.credentialRef);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
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

test("migrates missing connector configuration and enforces Jira read boundaries", () => {
  const missing = configurationFixture() as Record<string, unknown>;
  delete missing.connectors;
  assert.equal(validateConfiguration(missing).connectors.jira.enabled, false);

  const enabled = configurationFixture() as { connectors: { jira: Record<string, unknown> } };
  enabled.connectors.jira.enabled = true;
  enabled.connectors.jira.allowedProjects = [];
  assert.throws(() => validateConfiguration(enabled), /must not be empty/u);
  enabled.connectors.jira.allowedProjects = ["SAFE"];
  enabled.connectors.jira.baseUrl = "http://jira.example.test";
  assert.throws(() => validateConfiguration(enabled), /HTTPS URL/u);
  enabled.connectors.jira.baseUrl = "https://jira.example.test";
  enabled.connectors.jira.credentialRef = "plain-token";
  assert.throws(() => validateConfiguration(enabled), /os-keychain reference/u);
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
  assert.equal(publicView.catalogActivityWindowDays, 30);
});
