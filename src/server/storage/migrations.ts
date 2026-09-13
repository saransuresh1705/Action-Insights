import type { DatabaseSync } from "node:sqlite";

interface Migration {
  readonly version: number;
  readonly sql: string;
}

export const STORAGE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY,
        title_encrypted BLOB NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
        last_activity TEXT,
        access_status TEXT NOT NULL CHECK(access_status IN ('active', 'unavailable')),
        selected INTEGER NOT NULL CHECK(selected IN (0, 1)),
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE watched_collections (
        id TEXT PRIMARY KEY,
        name_encrypted BLOB NOT NULL,
        description_encrypted BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE collection_spaces (
        collection_id TEXT NOT NULL REFERENCES watched_collections(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        included_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, room_id)
      ) STRICT;
      CREATE TABLE sync_cursors (
        room_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
        high_watermark TEXT NOT NULL,
        content_hash TEXT,
        last_result TEXT NOT NULL CHECK(last_result IN ('complete', 'partial')),
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE message_refs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        parent_id TEXT,
        author_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        content_hash TEXT NOT NULL,
        text_encrypted BLOB,
        has_attachments INTEGER NOT NULL CHECK(has_attachments IN (0, 1)),
        deletion_state TEXT NOT NULL CHECK(deletion_state IN ('present', 'deleted')),
        retained_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX message_refs_room_created ON message_refs(room_id, created_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE spaces ADD COLUMN activity_window_status TEXT NOT NULL DEFAULT 'within-window'
        CHECK(activity_window_status IN ('within-window', 'outside-window', 'unknown'));
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE message_refs ADD COLUMN mentioned_people_json TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE space_summaries (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        coverage TEXT NOT NULL CHECK(coverage IN ('complete', 'partial')),
        payload_encrypted BLOB NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        model_name TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        stale INTEGER NOT NULL CHECK(stale IN (0, 1))
      ) STRICT;
      CREATE TABLE action_candidates (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        model_category TEXT NOT NULL,
        category TEXT NOT NULL,
        secondary_category TEXT,
        status TEXT NOT NULL,
        confidence_level TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        payload_encrypted BLOB NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        stale INTEGER NOT NULL CHECK(stale IN (0, 1)),
        user_modified_at TEXT
      ) STRICT;
      CREATE INDEX action_candidates_room_status ON action_candidates(room_id, status);
      CREATE TABLE local_acknowledgements (
        key TEXT PRIMARY KEY,
        acknowledged_at TEXT NOT NULL
      ) STRICT;
    `,
  },
];

export function applyStorageMigrations(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    PRAGMA trusted_schema = OFF;
  `);
  const current = database.prepare("PRAGMA user_version").get() as { user_version: number };
  const latest = STORAGE_MIGRATIONS.at(-1)?.version ?? 0;
  if (current.user_version > latest) {
    throw new Error("Local database schema is newer than this application version");
  }
  for (const migration of STORAGE_MIGRATIONS) {
    if (migration.version <= current.user_version) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error: unknown) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
