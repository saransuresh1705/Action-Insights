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

  const addCall = calls.find((call) => call.args[0] === "add-generic-password");
  assert.ok(addCall);
  assert.equal(addCall.args.includes("CANARY_SECRET_VALUE"), false);
  assert.equal(addCall.args.at(-1), "-w");
  assert.equal(addCall.input, "CANARY_SECRET_VALUE\n");
});

test("round-trips long values through bounded integrity-checked Keychain chunks", async () => {
  const items = new Map<string, string>();
  const calls: Array<{ args: readonly string[]; input?: string }> = [];
  const runner: SecurityCommandRunner = async (args, input) => {
    calls.push(input === undefined ? { args } : { args, input });
    const account = args[args.indexOf("-a") + 1] ?? "";
    switch (args[0]) {
      case "find-generic-password": {
        const stored = items.get(account);
        return stored === undefined
          ? { exitCode: 44, stdout: "", stderr: "" }
          : { exitCode: 0, stdout: `${stored}\n`, stderr: "" };
      }
      case "add-generic-password":
        items.set(account, input?.replace(/[\r\n]+$/u, "") ?? "");
        return { exitCode: 0, stdout: "", stderr: "" };
      case "delete-generic-password":
        return { exitCode: items.delete(account) ? 0 : 44, stdout: "", stderr: "" };
      default:
        return { exitCode: 1, stdout: "", stderr: "" };
    }
  };
  const store = new MacOsKeychainSecretStore(runner);
  const reference = "os-keychain://webex-action-insights/webex-oauth";
  const longValue = JSON.stringify({
    version: 1,
    clientSecret: "S".repeat(64),
    accessToken: "A".repeat(512),
    refreshToken: "R".repeat(512),
  });

  await store.set(reference, longValue);

  assert.equal(await store.get(reference), longValue);
  const addCalls = calls.filter((call) => call.args[0] === "add-generic-password");
  assert.ok(addCalls.length > 2);
  assert.equal(addCalls.some((call) => call.args.includes(longValue)), false);
  assert.equal(
    addCalls.every((call) => Buffer.byteLength(call.input?.replace(/[\r\n]+$/u, "") ?? "", "utf8") <= 96),
    true,
  );

  assert.equal(await store.delete(reference), true);
  assert.equal(items.size, 0);
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
