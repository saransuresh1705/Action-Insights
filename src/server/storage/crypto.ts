import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretStore } from "../secrets.js";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;

export class LocalDataKeyProvider {
  public constructor(
    private readonly secretStore: SecretStore,
    private readonly reference: string,
  ) {}

  public async getOrCreate(): Promise<Buffer> {
    const existing = await this.secretStore.get(this.reference);
    if (existing !== null) {
      const decoded = Buffer.from(existing, "base64url");
      if (decoded.length !== KEY_BYTES) throw new Error("Local data encryption key is invalid");
      return decoded;
    }
    const key = randomBytes(KEY_BYTES);
    await this.secretStore.set(this.reference, key.toString("base64url"));
    return key;
  }
}

export function encryptText(value: string, key: Buffer, context: string): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, ciphertext]);
}

export function decryptText(envelope: Uint8Array, key: Buffer, context: string): string {
  assertKey(key);
  const data = Buffer.from(envelope);
  if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== ENVELOPE_VERSION) {
    throw new Error("Encrypted local value has an unsupported format");
  }
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error("Local data encryption key must be 256 bits");
}
