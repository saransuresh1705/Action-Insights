import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { SecretStore } from "../src/server/secrets.js";
import { decryptText, encryptText, LocalDataKeyProvider } from "../src/server/storage/crypto.js";
import { LocalDatabase } from "../src/server/storage/database.js";
import { applyStorageMigrations, STORAGE_MIGRATIONS } from "../src/server/storage/migrations.js";

class MemorySecretStore implements SecretStore {
  public value: string | null = null;
  public async get(): Promise<string | null> { return this.value; }
  public async set(_reference: string, value: string): Promise<void> { this.value = value; }
  public async delete(): Promise<boolean> { this.value = null; return true; }
}

test("encrypts local text with authenticated context", () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptText("CANARY_PRIVATE_TEXT", key, "space:one:title");

  assert.equal(encrypted.includes(Buffer.from("CANARY_PRIVATE_TEXT")), false);
  assert.equal(decryptText(encrypted, key, "space:one:title"), "CANARY_PRIVATE_TEXT");
  assert.throws(() => decryptText(encrypted, key, "space:two:title"));
});

test("migrates existing space rows with a safe activity-window status", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(STORAGE_MIGRATIONS[0]?.sql ?? "");
  database.exec("PRAGMA user_version = 1");

  applyStorageMigrations(database);

  const columns = database.prepare("PRAGMA table_info(spaces)").all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === "activity_window_status"), true);
  assert.equal((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
  database.close();
});

test("persists spaces, collections, messages, and cursors without plaintext content", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "action-insights-store-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const secrets = new MemorySecretStore();
  const database = await LocalDatabase.open(directory, new LocalDataKeyProvider(secrets, "os-keychain://test/data"));

  database.upsertSpaces([{
    id: "room-1",
    title: "CANARY_PRIVATE_SPACE_TITLE",
    type: "direct",
    lastActivity: "2026-09-12T10:00:00.000Z",
    selected: false,
    activityWindowStatus: "within-window",
  }], "2026-09-12T10:01:00.000Z");
  database.createCollection("collection-1", "CANARY_PRIVATE_COLLECTION", "Sensitive description");
  database.replaceCollectionSpaces("collection-1", ["room-1"]);
  database.saveMessagesAndCursor("room-1", [{
    id: "message-1",
    roomId: "room-1",
    authorId: "person-1",
    created: "2026-09-12T10:00:00.000Z",
    text: "CANARY_PRIVATE_MESSAGE_BODY",
    mentionedPeople: [],
    hasAttachments: false,
    contentHash: "hash-1",
  }], "2026-09-12T10:00:00.000Z", "complete");

  assert.equal(database.listSpaces()[0]?.title, "CANARY_PRIVATE_SPACE_TITLE");
  assert.equal(database.listSpaces()[0]?.activityWindowStatus, "within-window");
  assert.deepEqual(database.selectedSpaceIds(), ["room-1"]);
  assert.equal(database.listCollections()[0]?.name, "CANARY_PRIVATE_COLLECTION");
  assert.equal(database.getCursor("room-1")?.highWatermark, "2026-09-12T10:00:00.000Z");
  assert.equal(database.purgeRawMessageTextBefore("2026-09-13T00:00:00.000Z"), 1);
  assert.equal(database.purgeRawMessageTextBefore("2026-09-13T00:00:00.000Z"), 0);
  database.close();

  const files = await readdir(directory);
  const bytes = Buffer.concat(await Promise.all(files.map(async (file) => await readFile(join(directory, file)))));
  for (const canary of ["CANARY_PRIVATE_SPACE_TITLE", "CANARY_PRIVATE_COLLECTION", "CANARY_PRIVATE_MESSAGE_BODY"]) {
    assert.equal(bytes.includes(Buffer.from(canary)), false);
  }
});
