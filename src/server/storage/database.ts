import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WebexSpaceSummary } from "../../shared/contracts.js";
import type { NormalizedWebexMessage } from "../webex/types.js";
import { decryptText, encryptText, type LocalDataKeyProvider } from "./crypto.js";
import { applyStorageMigrations } from "./migrations.js";

export interface StoredSpace extends WebexSpaceSummary {
  readonly accessStatus: "active" | "unavailable";
}

export interface WatchedCollection {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly spaceIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SyncCursor {
  readonly roomId: string;
  readonly highWatermark: string;
  readonly contentHash?: string;
  readonly lastResult: "complete" | "partial";
  readonly updatedAt: string;
}

interface SpaceRow {
  readonly id: string;
  readonly title_encrypted: Uint8Array;
  readonly type: "direct" | "group";
  readonly last_activity: string | null;
  readonly access_status: "active" | "unavailable";
  readonly selected: number;
  readonly activity_window_status: "within-window" | "outside-window" | "unknown";
}

interface CollectionRow {
  readonly id: string;
  readonly name_encrypted: Uint8Array;
  readonly description_encrypted: Uint8Array;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CursorRow {
  readonly room_id: string;
  readonly high_watermark: string;
  readonly content_hash: string | null;
  readonly last_result: "complete" | "partial";
  readonly updated_at: string;
}

export class LocalDatabase {
  private constructor(
    private readonly database: DatabaseSync,
    private readonly encryptionKey: Buffer,
  ) {
    applyStorageMigrations(database);
  }

  public static async open(dataDirectory: string, keyProvider: LocalDataKeyProvider): Promise<LocalDatabase> {
    const directory = resolveDataDirectory(dataDirectory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const databasePath = join(directory, "action-insights.sqlite3");
    const key = await keyProvider.getOrCreate();
    const database = new DatabaseSync(databasePath);
    await chmod(databasePath, 0o600);
    return new LocalDatabase(database, key);
  }

  public static inMemory(encryptionKey: Buffer): LocalDatabase {
    return new LocalDatabase(new DatabaseSync(":memory:"), encryptionKey);
  }

  public close(): void {
    this.database.close();
  }

  public upsertSpaces(spaces: readonly WebexSpaceSummary[], retrievedAt: string): void {
    const statement = this.database.prepare(`
      INSERT INTO spaces (
        id, title_encrypted, type, last_activity, activity_window_status,
        access_status, selected, discovered_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'active', COALESCE((SELECT selected FROM spaces WHERE id = ?), 0), ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title_encrypted = excluded.title_encrypted,
        type = excluded.type,
        last_activity = excluded.last_activity,
        activity_window_status = excluded.activity_window_status,
        access_status = 'active',
        updated_at = excluded.updated_at
    `);
    this.transaction(() => {
      for (const space of spaces) {
        statement.run(
          space.id,
          encryptText(space.title, this.encryptionKey, `spaces:${space.id}:title`),
          space.type,
          space.lastActivity ?? null,
          space.activityWindowStatus ?? "within-window",
          space.id,
          retrievedAt,
          retrievedAt,
        );
      }
    });
  }

  public listSpaces(): readonly StoredSpace[] {
    const rows = this.database.prepare(`
      SELECT id, title_encrypted, type, last_activity, access_status, selected, activity_window_status
      FROM spaces ORDER BY COALESCE(last_activity, '') DESC, id
    `).all() as unknown as SpaceRow[];
    return rows.map((row) => ({
      id: row.id,
      title: decryptText(row.title_encrypted, this.encryptionKey, `spaces:${row.id}:title`),
      type: row.type,
      ...(row.last_activity === null ? {} : { lastActivity: row.last_activity }),
      selected: row.selected === 1,
      activityWindowStatus: row.activity_window_status,
      accessStatus: row.access_status,
    }));
  }

  public createCollection(id: string, name: string, description = "", now = new Date().toISOString()): WatchedCollection {
    this.database.prepare(`
      INSERT INTO watched_collections (id, name_encrypted, description_encrypted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      encryptText(name, this.encryptionKey, `collections:${id}:name`),
      encryptText(description, this.encryptionKey, `collections:${id}:description`),
      now,
      now,
    );
    return { id, name, description, spaceIds: [], createdAt: now, updatedAt: now };
  }

  public listCollections(): readonly WatchedCollection[] {
    const rows = this.database.prepare(`
      SELECT id, name_encrypted, description_encrypted, created_at, updated_at
      FROM watched_collections ORDER BY created_at, id
    `).all() as unknown as CollectionRow[];
    const spaceStatement = this.database.prepare(
      "SELECT room_id FROM collection_spaces WHERE collection_id = ? ORDER BY room_id",
    );
    return rows.map((row) => ({
      id: row.id,
      name: decryptText(row.name_encrypted, this.encryptionKey, `collections:${row.id}:name`),
      description: decryptText(row.description_encrypted, this.encryptionKey, `collections:${row.id}:description`),
      spaceIds: (spaceStatement.all(row.id) as Array<{ room_id: string }>).map((item) => item.room_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public replaceCollectionSpaces(collectionId: string, roomIds: readonly string[], now = new Date().toISOString()): void {
    const insert = this.database.prepare(
      "INSERT INTO collection_spaces (collection_id, room_id, included_at) VALUES (?, ?, ?)",
    );
    this.transaction(() => {
      this.database.prepare("DELETE FROM collection_spaces WHERE collection_id = ?").run(collectionId);
      for (const roomId of new Set(roomIds)) insert.run(collectionId, roomId, now);
      this.database.prepare("UPDATE watched_collections SET updated_at = ? WHERE id = ?").run(now, collectionId);
      this.database.prepare("UPDATE spaces SET selected = 0").run();
      this.database.prepare(`
        UPDATE spaces SET selected = 1 WHERE id IN (SELECT DISTINCT room_id FROM collection_spaces)
      `).run();
    });
  }

  public selectedSpaceIds(): readonly string[] {
    return (this.database.prepare(
      "SELECT DISTINCT room_id FROM collection_spaces ORDER BY room_id",
    ).all() as Array<{ room_id: string }>).map((row) => row.room_id);
  }

  public saveMessagesAndCursor(
    roomId: string,
    messages: readonly NormalizedWebexMessage[],
    highWatermark: string | undefined,
    result: "complete" | "partial",
    now = new Date().toISOString(),
  ): void {
    const upsert = this.database.prepare(`
      INSERT INTO message_refs (
        id, room_id, parent_id, author_id, created_at, updated_at, content_hash,
        text_encrypted, has_attachments, deletion_state, retained_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        author_id = excluded.author_id,
        updated_at = excluded.updated_at,
        content_hash = excluded.content_hash,
        text_encrypted = excluded.text_encrypted,
        has_attachments = excluded.has_attachments,
        deletion_state = 'present',
        retained_at = excluded.retained_at
    `);
    this.transaction(() => {
      for (const message of messages) {
        upsert.run(
          message.id,
          roomId,
          message.parentId ?? null,
          message.authorId ?? null,
          message.created,
          message.updated ?? null,
          message.contentHash,
          encryptText(message.text, this.encryptionKey, `messages:${message.id}:text`),
          message.hasAttachments ? 1 : 0,
          now,
        );
      }
      if (highWatermark !== undefined) {
        const contentHash = messages.at(-1)?.contentHash ?? null;
        this.database.prepare(`
          INSERT INTO sync_cursors (room_id, high_watermark, content_hash, last_result, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(room_id) DO UPDATE SET
            high_watermark = excluded.high_watermark,
            content_hash = excluded.content_hash,
            last_result = excluded.last_result,
            updated_at = excluded.updated_at
        `).run(roomId, highWatermark, contentHash, result, now);
      }
    });
  }

  public getCursor(roomId: string): SyncCursor | null {
    const row = this.database.prepare(`
      SELECT room_id, high_watermark, content_hash, last_result, updated_at
      FROM sync_cursors WHERE room_id = ?
    `).get(roomId) as unknown as CursorRow | undefined;
    if (row === undefined) return null;
    return {
      roomId: row.room_id,
      highWatermark: row.high_watermark,
      ...(row.content_hash === null ? {} : { contentHash: row.content_hash }),
      lastResult: row.last_result,
      updatedAt: row.updated_at,
    };
  }

  public purgeRawMessageTextBefore(cutoff: string): number {
    const result = this.database.prepare(`
      UPDATE message_refs SET text_encrypted = NULL WHERE created_at < ? AND text_encrypted IS NOT NULL
    `).run(cutoff);
    return Number(result.changes);
  }

  private transaction(operation: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.database.exec("COMMIT");
    } catch (error: unknown) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function resolveDataDirectory(configured: string): string {
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
  return resolve(configured);
}
