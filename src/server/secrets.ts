import { spawn } from "node:child_process";

export interface SecretStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<boolean>;
}

export interface SecretReference {
  readonly service: string;
  readonly account: string;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type SecurityCommandRunner = (args: readonly string[], input?: string) => Promise<CommandResult>;

export class SecretStoreError extends Error {
  public constructor(
    message: string,
    public readonly code: "unsupported-reference" | "keychain-failure" | "invalid-secret",
  ) {
    super(message);
    this.name = "SecretStoreError";
  }
}

export class MacOsKeychainSecretStore implements SecretStore {
  public constructor(private readonly run: SecurityCommandRunner = runSecurityCommand) {}

  public async get(reference: string): Promise<string | null> {
    const { service, account } = parseSecretReference(reference);
    const result = await this.run(["find-generic-password", "-a", account, "-s", service, "-w"]);
    if (result.exitCode === 44) {
      return null;
    }
    if (result.exitCode !== 0) {
      throw new SecretStoreError("Unable to read the requested macOS Keychain item", "keychain-failure");
    }
    return result.stdout.replace(/[\r\n]+$/, "");
  }

  public async set(reference: string, value: string): Promise<void> {
    if (value === "" || /[\u0000\r\n]/u.test(value)) {
      throw new SecretStoreError("Secret values must be non-empty single-line strings", "invalid-secret");
    }
    const { service, account } = parseSecretReference(reference);
    const result = await this.run(
      ["add-generic-password", "-U", "-a", account, "-s", service, "-w"],
      `${value}\n`,
    );
    if (result.exitCode !== 0) {
      throw new SecretStoreError("Unable to update the requested macOS Keychain item", "keychain-failure");
    }
  }

  public async delete(reference: string): Promise<boolean> {
    const { service, account } = parseSecretReference(reference);
    const result = await this.run(["delete-generic-password", "-a", account, "-s", service]);
    if (result.exitCode === 44) {
      return false;
    }
    if (result.exitCode !== 0) {
      throw new SecretStoreError("Unable to delete the requested macOS Keychain item", "keychain-failure");
    }
    return true;
  }
}

export function parseSecretReference(reference: string): SecretReference {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    throw new SecretStoreError("Credential reference is invalid", "unsupported-reference");
  }
  const account = url.pathname.replace(/^\//u, "");
  if (
    url.protocol !== "os-keychain:" ||
    url.hostname === "" ||
    account === "" ||
    account.includes("/") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new SecretStoreError("Credential reference must identify one macOS Keychain service and account", "unsupported-reference");
  }
  return { service: url.hostname, account };
}

async function runSecurityCommand(args: readonly string[], input?: string): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const needsPasswordPrompt = args[0] === "add-generic-password" && args.at(-1) === "-w";
    const accountIndex = args.indexOf("-a");
    const serviceIndex = args.indexOf("-s");
    const executable = needsPasswordPrompt ? "/usr/bin/expect" : "/usr/bin/security";
    const commandArgs = needsPasswordPrompt ? ["-c", KEYCHAIN_PASSWORD_EXPECT_SCRIPT] : args;
    const environment = needsPasswordPrompt
      ? {
          ...process.env,
          ACTION_INSIGHTS_KEYCHAIN_ACCOUNT: args[accountIndex + 1] ?? "",
          ACTION_INSIGHTS_KEYCHAIN_SERVICE: args[serviceIndex + 1] ?? "",
        }
      : process.env;
    const child = spawn(executable, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: environment,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 1_048_576) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

const KEYCHAIN_PASSWORD_EXPECT_SCRIPT = String.raw`
log_user 0
set timeout 15
if {[gets stdin secret] < 0 || $secret eq ""} { exit 64 }
spawn -noecho /usr/bin/security add-generic-password -U \
  -a $env(ACTION_INSIGHTS_KEYCHAIN_ACCOUNT) \
  -s $env(ACTION_INSIGHTS_KEYCHAIN_SERVICE) -w
expect {
  -re {password data for (new )?item:} { send -- "$secret\r" }
  timeout { exit 70 }
  eof { set result [wait]; exit [lindex $result 3] }
}
expect {
  -re {retype password for new item:} { send -- "$secret\r"; exp_continue }
  timeout { exit 70 }
  eof { set result [wait]; exit [lindex $result 3] }
}
`;
