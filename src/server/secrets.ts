import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const DIRECT_VALUE_MAX_BYTES = 96;
const ENCODED_CHUNK_MAX_CHARS = 96;
const CHUNK_MANIFEST_PREFIX = "wai-chunked-v1";

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
    const stored = await this.readItem(service, account);
    if (stored === null) return null;

    const manifest = parseChunkManifest(stored);
    if (manifest === null) return stored;

    const encodedChunks: string[] = [];
    for (let index = 0; index < manifest.count; index += 1) {
      const chunk = await this.readItem(service, chunkAccount(account, manifest.generation, index));
      if (chunk === null) {
        throw new SecretStoreError("A macOS Keychain secret chunk is missing", "keychain-failure");
      }
      encodedChunks.push(chunk);
    }

    const bytes = Buffer.from(encodedChunks.join(""), "base64url");
    if (digest(bytes) !== manifest.digest) {
      throw new SecretStoreError("A macOS Keychain secret failed integrity validation", "keychain-failure");
    }
    return bytes.toString("utf8");
  }

  public async set(reference: string, value: string): Promise<void> {
    if (value === "" || /[\u0000\r\n]/u.test(value)) {
      throw new SecretStoreError("Secret values must be non-empty single-line strings", "invalid-secret");
    }
    const { service, account } = parseSecretReference(reference);
    const previous = parseChunkManifest(await this.readItem(service, account));
    const bytes = Buffer.from(value, "utf8");

    if (bytes.length <= DIRECT_VALUE_MAX_BYTES) {
      await this.writeItem(service, account, value);
      if (previous !== null) await this.deleteChunks(service, account, previous);
      return;
    }

    const valueDigest = digest(bytes);
    const generation = valueDigest.slice(0, 12);
    const chunks = splitEncodedValue(bytes.toString("base64url"));
    const writtenAccounts: string[] = [];
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const partAccount = chunkAccount(account, generation, index);
        await this.writeItem(service, partAccount, chunks[index] ?? "");
        writtenAccounts.push(partAccount);
      }
      await this.writeItem(
        service,
        account,
        `${CHUNK_MANIFEST_PREFIX}:${generation}:${chunks.length}:${valueDigest}`,
      );
    } catch (error: unknown) {
      await this.deleteAccountsBestEffort(service, writtenAccounts);
      throw error;
    }

    if (previous !== null && previous.generation !== generation) {
      await this.deleteChunks(service, account, previous);
    }
  }

  public async delete(reference: string): Promise<boolean> {
    const { service, account } = parseSecretReference(reference);
    const stored = await this.readItem(service, account);
    if (stored === null) return false;
    const manifest = parseChunkManifest(stored);
    await this.deleteItem(service, account);
    if (manifest !== null) await this.deleteChunks(service, account, manifest);
    return true;
  }

  private async readItem(service: string, account: string): Promise<string | null> {
    const result = await this.run(["find-generic-password", "-a", account, "-s", service, "-w"]);
    if (result.exitCode === 44) return null;
    if (result.exitCode !== 0) {
      throw new SecretStoreError("Unable to read the requested macOS Keychain item", "keychain-failure");
    }
    return result.stdout.replace(/[\r\n]+$/u, "");
  }

  private async writeItem(service: string, account: string, value: string): Promise<void> {
    if (value === "" || Buffer.byteLength(value, "utf8") > DIRECT_VALUE_MAX_BYTES) {
      throw new SecretStoreError("A Keychain item exceeds the bounded prompt size", "invalid-secret");
    }
    const result = await this.run(
      ["add-generic-password", "-U", "-a", account, "-s", service, "-w"],
      `${value}\n`,
    );
    if (result.exitCode !== 0) {
      throw new SecretStoreError("Unable to update the requested macOS Keychain item", "keychain-failure");
    }
  }

  private async deleteItem(service: string, account: string): Promise<void> {
    const result = await this.run(["delete-generic-password", "-a", account, "-s", service]);
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new SecretStoreError("Unable to delete the requested macOS Keychain item", "keychain-failure");
    }
  }

  private async deleteChunks(service: string, account: string, manifest: ChunkManifest): Promise<void> {
    for (let index = 0; index < manifest.count; index += 1) {
      await this.deleteItem(service, chunkAccount(account, manifest.generation, index));
    }
  }

  private async deleteAccountsBestEffort(service: string, accounts: readonly string[]): Promise<void> {
    await Promise.all(
      accounts.map(async (account) => {
        try {
          await this.deleteItem(service, account);
        } catch {
          // Preserve the original failure; unreferenced chunks are not reachable through the configured reference.
        }
      }),
    );
  }
}

interface ChunkManifest {
  readonly generation: string;
  readonly count: number;
  readonly digest: string;
}

function parseChunkManifest(value: string | null): ChunkManifest | null {
  if (value === null) return null;
  const match = new RegExp(
    `^${CHUNK_MANIFEST_PREFIX}:([a-f0-9]{12}):([1-9][0-9]{0,5}):([a-f0-9]{64})$`,
    "u",
  ).exec(value);
  if (match === null) return null;
  const count = Number(match[2]);
  if (!Number.isSafeInteger(count) || count > 10_000) return null;
  return { generation: match[1] ?? "", count, digest: match[3] ?? "" };
}

function splitEncodedValue(encoded: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += ENCODED_CHUNK_MAX_CHARS) {
    chunks.push(encoded.slice(offset, offset + ENCODED_CHUNK_MAX_CHARS));
  }
  return chunks;
}

function chunkAccount(account: string, generation: string, index: number): string {
  return `${account}.chunk.${generation}.${String(index).padStart(4, "0")}`;
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
