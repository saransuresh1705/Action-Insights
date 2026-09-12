import assert from "node:assert/strict";
import test from "node:test";
import { MacOsKeychainSecretStore, parseSecretReference, type SecurityCommandRunner } from "../src/server/secrets.js";

test("parses a bounded macOS Keychain reference", () => {
  assert.deepEqual(parseSecretReference("os-keychain://webex-action-insights/webex-oauth"), {
    service: "webex-action-insights",
    account: "webex-oauth",
  });
  assert.throws(() => parseSecretReference("file:///tmp/secret"), /must identify one macOS Keychain/);
  assert.throws(() => parseSecretReference("os-keychain://service/account/extra"), /must identify one macOS Keychain/);
});

test("passes a new secret over stdin instead of process arguments", async () => {
  const calls: Array<{ args: readonly string[]; input?: string }> = [];
  const runner: SecurityCommandRunner = async (args, input) => {
    calls.push(input === undefined ? { args } : { args, input });
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const store = new MacOsKeychainSecretStore(runner);

  await store.set("os-keychain://webex-action-insights/webex-oauth", "CANARY_SECRET_VALUE");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.args.includes("CANARY_SECRET_VALUE"), false);
  assert.equal(calls[0]?.args.at(-1), "-w");
  assert.equal(calls[0]?.input, "CANARY_SECRET_VALUE\n");
});

test("returns null for a missing Keychain item and never exposes stderr", async () => {
  const runner: SecurityCommandRunner = async () => ({
    exitCode: 44,
    stdout: "",
    stderr: "CANARY_KEYCHAIN_DIAGNOSTIC",
  });
  const store = new MacOsKeychainSecretStore(runner);
  assert.equal(await store.get("os-keychain://webex-action-insights/webex-oauth"), null);
});
