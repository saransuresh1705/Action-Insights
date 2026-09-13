import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActionCandidateView,
  ActionCategory,
  ActionFeedbackInput,
  ActionRecommendationView,
  ActionStatus,
  ConfidenceLevel,
  ConnectorEvidenceView,
  InsightDashboard,
  ResponseDraftView,
  SpaceSummaryView,
  WebexSpaceSummary,
} from "../../shared/contracts.js";
import type { AnalysisInputMessage } from "../analysis/types.js";
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

export interface StoredAnalysisContext {
  readonly roomId: string;
  readonly spaceTitle: string;
  readonly spaceType: "direct" | "group";
  readonly coverage: "complete" | "partial";
  readonly messages: readonly AnalysisInputMessage[];
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

interface AnalysisMessageRow {
  readonly id: string;
  readonly parent_id: string | null;
  readonly author_id: string | null;
  readonly created_at: string;
  readonly text_encrypted: Uint8Array | null;
  readonly mentioned_people_json: string;
  readonly has_attachments: number;
}

interface SummaryRow {
  readonly id: string;
  readonly room_id: string;
  readonly title_encrypted: Uint8Array;
  readonly period_start: string;
  readonly period_end: string;
  readonly coverage: "complete" | "partial";
  readonly payload_encrypted: Uint8Array;
  readonly evidence_ids_json: string;
  readonly model_name: string;
  readonly analyzed_at: string;
  readonly stale: number;
}

interface ActionRow {
  readonly id: string;
  readonly room_id: string;
  readonly title_encrypted: Uint8Array;
  readonly category: ActionCategory;
  readonly secondary_category: ActionCategory | null;
  readonly status: ActionStatus;
  readonly confidence_level: ConfidenceLevel;
  readonly confidence_score: number;
  readonly payload_encrypted: Uint8Array;
  readonly evidence_ids_json: string;
  readonly source_message_id: string;
  readonly model_name: string;
  readonly analyzed_at: string;
  readonly stale: number;
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
        text_encrypted, mentioned_people_json, has_attachments, deletion_state, retained_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        author_id = excluded.author_id,
        updated_at = excluded.updated_at,
        content_hash = excluded.content_hash,
        text_encrypted = excluded.text_encrypted,
        mentioned_people_json = excluded.mentioned_people_json,
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
          JSON.stringify(message.mentionedPeople),
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

  public analysisContext(roomId: string, since: string): StoredAnalysisContext | null {
    const space = this.database.prepare(`
      SELECT id, title_encrypted, type FROM spaces WHERE id = ?
    `).get(roomId) as unknown as Pick<SpaceRow, "id" | "title_encrypted" | "type"> | undefined;
    if (space === undefined) return null;
    const rows = this.database.prepare(`
      SELECT id, parent_id, author_id, created_at, text_encrypted, mentioned_people_json, has_attachments
      FROM message_refs
      WHERE room_id = ? AND created_at >= ? AND text_encrypted IS NOT NULL AND deletion_state = 'present'
      ORDER BY created_at, id
    `).all(roomId, since) as unknown as AnalysisMessageRow[];
    const cursor = this.getCursor(roomId);
    return {
      roomId,
      spaceTitle: decryptText(space.title_encrypted, this.encryptionKey, `spaces:${roomId}:title`),
      spaceType: space.type,
      coverage: cursor?.lastResult ?? "partial",
      messages: rows.map((row) => ({
        id: row.id,
        ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
        ...(row.author_id === null ? {} : { authorId: row.author_id }),
        created: row.created_at,
        text: decryptText(row.text_encrypted as Uint8Array, this.encryptionKey, `messages:${row.id}:text`),
        mentionedPeople: parseStringArray(row.mentioned_people_json),
        hasAttachments: row.has_attachments === 1,
      })),
    };
  }

  public saveInsights(summary: SpaceSummaryView, actions: readonly ActionCandidateView[]): void {
    const summaryPayload = JSON.stringify({
      overview: summary.overview,
      mainTopics: summary.mainTopics,
      decisions: summary.decisions,
      openQuestions: summary.openQuestions,
      risks: summary.risks,
      userActions: summary.userActions,
      otherActions: summary.otherActions,
      importantLinks: summary.importantLinks,
      noMaterialActivity: summary.noMaterialActivity,
    });
    const upsertSummary = this.database.prepare(`
      INSERT INTO space_summaries (
        id, room_id, period_start, period_end, coverage, payload_encrypted,
        evidence_ids_json, model_name, analyzed_at, stale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        id = excluded.id, period_start = excluded.period_start, period_end = excluded.period_end,
        coverage = excluded.coverage, payload_encrypted = excluded.payload_encrypted,
        evidence_ids_json = excluded.evidence_ids_json, model_name = excluded.model_name,
        analyzed_at = excluded.analyzed_at, stale = excluded.stale
    `);
    const existing = this.database.prepare(`
      SELECT category, status, confidence_level, payload_encrypted, user_modified_at
      FROM action_candidates WHERE id = ?
    `);
    const upsertAction = this.database.prepare(`
      INSERT INTO action_candidates (
        id, room_id, model_category, category, secondary_category, status,
        confidence_level, confidence_score, payload_encrypted, evidence_ids_json,
        source_message_id, model_name, analyzed_at, stale, user_modified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        model_category = excluded.model_category,
        category = CASE WHEN action_candidates.user_modified_at IS NULL THEN excluded.category ELSE action_candidates.category END,
        secondary_category = excluded.secondary_category,
        status = CASE WHEN action_candidates.user_modified_at IS NULL THEN excluded.status ELSE action_candidates.status END,
        confidence_level = CASE WHEN action_candidates.user_modified_at IS NULL THEN excluded.confidence_level ELSE action_candidates.confidence_level END,
        confidence_score = excluded.confidence_score,
        payload_encrypted = excluded.payload_encrypted,
        evidence_ids_json = excluded.evidence_ids_json,
        source_message_id = excluded.source_message_id,
        model_name = excluded.model_name,
        analyzed_at = excluded.analyzed_at,
        stale = excluded.stale
    `);
    this.transaction(() => {
      upsertSummary.run(
        summary.id, summary.roomId, summary.periodStart, summary.periodEnd, summary.coverage,
        encryptText(summaryPayload, this.encryptionKey, `summaries:${summary.id}:payload`),
        JSON.stringify(summary.evidenceMessageIds), summary.modelName, summary.analyzedAt, summary.stale ? 1 : 0,
      );
      this.database.prepare("UPDATE action_candidates SET stale = 1 WHERE room_id = ?").run(summary.roomId);
      for (const action of actions) {
        const prior = existing.get(action.id) as unknown as {
          category: ActionCategory;
          status: ActionStatus;
          confidence_level: ConfidenceLevel;
          payload_encrypted: Uint8Array;
          user_modified_at: string | null;
        } | undefined;
        let payload: Record<string, unknown> = actionPayload(action);
        if (prior?.user_modified_at !== null && prior !== undefined) {
          const priorPayload = parseRecord(decryptText(prior.payload_encrypted, this.encryptionKey, `actions:${action.id}:payload`));
          payload.owner = priorPayload.owner;
          payload.dueDate = priorPayload.dueDate;
          payload.dueDateInferred = priorPayload.dueDateInferred;
        }
        upsertAction.run(
          action.id, action.roomId, action.category, action.category, action.secondaryCategory ?? null,
          action.status, action.confidence, action.confidenceScore,
          encryptText(JSON.stringify(payload), this.encryptionKey, `actions:${action.id}:payload`),
          JSON.stringify(action.evidenceMessageIds), action.sourceMessageId, action.modelName,
          action.analyzedAt, action.stale ? 1 : 0, prior?.user_modified_at ?? null,
        );
      }
    });
  }

  public markInsightsStale(roomId: string): void {
    this.transaction(() => {
      this.database.prepare("UPDATE space_summaries SET stale = 1 WHERE room_id = ?").run(roomId);
      this.database.prepare("UPDATE action_candidates SET stale = 1 WHERE room_id = ?").run(roomId);
    });
  }

  public listInsights(): InsightDashboard {
    const summaries = this.database.prepare(`
      SELECT ss.*, s.title_encrypted FROM space_summaries ss
      JOIN spaces s ON s.id = ss.room_id ORDER BY ss.analyzed_at DESC
    `).all() as unknown as SummaryRow[];
    const actions = this.database.prepare(`
      SELECT ac.*, s.title_encrypted FROM action_candidates ac
      JOIN spaces s ON s.id = ac.room_id
      WHERE ac.status NOT IN ('Resolved', 'Dismissed', 'Not mine')
      ORDER BY ac.stale, CASE ac.confidence_level WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
        ac.analyzed_at DESC
    `).all() as unknown as ActionRow[];
    const collections = this.database.prepare(`
      SELECT wc.id, wc.name_encrypted, cs.room_id FROM watched_collections wc
      JOIN collection_spaces cs ON cs.collection_id = wc.id
    `).all() as unknown as Array<{ id: string; name_encrypted: Uint8Array; room_id: string }>;
    const namesByRoom = new Map<string, string[]>();
    for (const collection of collections) {
      const names = namesByRoom.get(collection.room_id) ?? [];
      names.push(decryptText(collection.name_encrypted, this.encryptionKey, `collections:${collection.id}:name`));
      namesByRoom.set(collection.room_id, names);
    }
    return {
      summaries: summaries.map((row) => summaryView(row, this.encryptionKey)),
      actions: actions.map((row) => actionView(row, this.encryptionKey, namesByRoom.get(row.room_id) ?? [])),
    };
  }

  public updateActionFeedback(id: string, input: ActionFeedbackInput, now = new Date().toISOString()): ActionCandidateView | null {
    const row = this.database.prepare(`
      SELECT ac.*, s.title_encrypted FROM action_candidates ac JOIN spaces s ON s.id = ac.room_id WHERE ac.id = ?
    `).get(id) as unknown as ActionRow | undefined;
    if (row === undefined) return null;
    const payload = parseRecord(decryptText(row.payload_encrypted, this.encryptionKey, `actions:${id}:payload`));
    if (input.owner !== undefined) payload.owner = input.owner;
    if (input.dueDate !== undefined) {
      payload.dueDate = input.dueDate;
      payload.dueDateInferred = false;
    }
    this.database.prepare(`
      UPDATE action_candidates SET category = ?, status = ?, confidence_level = ?,
        payload_encrypted = ?, user_modified_at = ? WHERE id = ?
    `).run(
      input.category ?? row.category,
      input.status ?? row.status,
      input.confidence ?? row.confidence_level,
      encryptText(JSON.stringify(payload), this.encryptionKey, `actions:${id}:payload`),
      now,
      id,
    );
    return this.getInsightAction(id);
  }

  public hasAcknowledgement(key: string): boolean {
    return this.database.prepare("SELECT 1 FROM local_acknowledgements WHERE key = ?").get(key) !== undefined;
  }

  public setAcknowledgement(key: string, now = new Date().toISOString()): void {
    this.database.prepare(`
      INSERT INTO local_acknowledgements (key, acknowledged_at) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET acknowledged_at = excluded.acknowledged_at
    `).run(key, now);
  }

  public purgeRawMessageTextBefore(cutoff: string): number {
    const result = this.database.prepare(`
      UPDATE message_refs SET text_encrypted = NULL WHERE created_at < ? AND text_encrypted IS NOT NULL
    `).run(cutoff);
    return Number(result.changes);
  }

  public purgeDerivedInsightsBefore(cutoff: string): number {
    let changes = 0;
    this.transaction(() => {
      changes += Number(this.database.prepare("DELETE FROM space_summaries WHERE analyzed_at < ?").run(cutoff).changes);
      changes += Number(this.database.prepare("DELETE FROM action_candidates WHERE analyzed_at < ?").run(cutoff).changes);
    });
    return changes;
  }

  public getInsightAction(id: string): ActionCandidateView | null {
    const row = this.database.prepare(`
      SELECT ac.*, s.title_encrypted FROM action_candidates ac JOIN spaces s ON s.id = ac.room_id WHERE ac.id = ?
    `).get(id) as unknown as ActionRow | undefined;
    if (row === undefined) return null;
    const collectionRows = this.database.prepare(`
      SELECT wc.id, wc.name_encrypted FROM watched_collections wc JOIN collection_spaces cs ON cs.collection_id = wc.id
      WHERE cs.room_id = ? ORDER BY wc.created_at
    `).all(row.room_id) as unknown as Array<{ id: string; name_encrypted: Uint8Array }>;
    return actionView(row, this.encryptionKey, collectionRows.map((collection) =>
      decryptText(collection.name_encrypted, this.encryptionKey, `collections:${collection.id}:name`)));
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

function parseStringArray(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch { return []; }
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid encrypted insight payload");
  return parsed as Record<string, unknown>;
}

function actionPayload(action: ActionCandidateView): Record<string, unknown> {
  return {
    rationale: action.rationale, owner: action.owner, dueDate: action.dueDate ?? null,
    dueDateInferred: action.dueDateInferred, urgency: action.urgency, dependencies: action.dependencies,
    recommendedNextStep: action.recommendedNextStep, sourceAuthor: action.sourceAuthor,
    sourceTimestamp: action.sourceTimestamp, sourceSnippet: action.sourceSnippet,
    contextPreview: action.contextPreview, sourceUrl: action.sourceUrl,
    compatibilityWarning: action.compatibilityWarning,
    responseDraft: action.responseDraft ?? null,
    recommendation: action.recommendation ?? null,
    connectorEvidence: action.connectorEvidence,
    connectorWarnings: action.connectorWarnings,
  };
}

function stringArrayFromRecord(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function responseDraftFromRecord(value: unknown): ResponseDraftView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const draft = value as Record<string, unknown>;
  const tone = draft.tone;
  if (typeof draft.text !== "string" || typeof draft.generatedAt !== "string"
    || (tone !== "concise" && tone !== "neutral" && tone !== "warm" && tone !== "formal")) return undefined;
  return {
    text: draft.text,
    tone,
    clarifyingQuestions: stringArrayFromRecord(draft, "clarifyingQuestions"),
    generatedAt: draft.generatedAt,
  };
}

function recommendationFromRecord(value: unknown): ActionRecommendationView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const recommendation = value as Record<string, unknown>;
  return {
    steps: stringArrayFromRecord(recommendation, "steps"),
    missingInformation: stringArrayFromRecord(recommendation, "missingInformation"),
    completionCriteria: stringArrayFromRecord(recommendation, "completionCriteria"),
    facts: stringArrayFromRecord(recommendation, "facts"),
    inferences: stringArrayFromRecord(recommendation, "inferences"),
    userDecisions: stringArrayFromRecord(recommendation, "userDecisions"),
    sideEffectingActions: stringArrayFromRecord(recommendation, "sideEffectingActions"),
  };
}

function connectorEvidenceFromRecord(value: unknown): readonly ConnectorEvidenceView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ConnectorEvidenceView[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const evidence = entry as Record<string, unknown>;
    if (evidence.connector !== "jira" || typeof evidence.id !== "string" || typeof evidence.itemId !== "string"
      || typeof evidence.title !== "string" || typeof evidence.status !== "string" || typeof evidence.url !== "string"
      || typeof evidence.retrievedAt !== "string" || typeof evidence.stale !== "boolean") return [];
    return [evidence as unknown as ConnectorEvidenceView];
  });
}

function summaryView(row: SummaryRow, key: Buffer): SpaceSummaryView {
  const payload = parseRecord(decryptText(row.payload_encrypted, key, `summaries:${row.id}:payload`));
  return {
    id: row.id, roomId: row.room_id,
    spaceTitle: decryptText(row.title_encrypted, key, `spaces:${row.room_id}:title`),
    periodStart: row.period_start, periodEnd: row.period_end, coverage: row.coverage,
    overview: typeof payload.overview === "string" ? payload.overview : "",
    mainTopics: stringArrayFromRecord(payload, "mainTopics"), decisions: stringArrayFromRecord(payload, "decisions"),
    openQuestions: stringArrayFromRecord(payload, "openQuestions"), risks: stringArrayFromRecord(payload, "risks"),
    userActions: stringArrayFromRecord(payload, "userActions"), otherActions: stringArrayFromRecord(payload, "otherActions"),
    importantLinks: stringArrayFromRecord(payload, "importantLinks"), noMaterialActivity: payload.noMaterialActivity === true,
    evidenceMessageIds: parseStringArray(row.evidence_ids_json), modelName: row.model_name,
    analyzedAt: row.analyzed_at, stale: row.stale === 1,
  };
}

function actionView(row: ActionRow, key: Buffer, collectionNames: readonly string[]): ActionCandidateView {
  const payload = parseRecord(decryptText(row.payload_encrypted, key, `actions:${row.id}:payload`));
  const text = (name: string): string => typeof payload[name] === "string" ? payload[name] as string : "";
  const responseDraft = responseDraftFromRecord(payload.responseDraft);
  const recommendation = recommendationFromRecord(payload.recommendation);
  return {
    id: row.id, roomId: row.room_id,
    spaceTitle: decryptText(row.title_encrypted, key, `spaces:${row.room_id}:title`), collectionNames,
    category: row.category, ...(row.secondary_category === null ? {} : { secondaryCategory: row.secondary_category }),
    status: row.status, confidence: row.confidence_level, confidenceScore: row.confidence_score,
    rationale: text("rationale"), owner: text("owner"),
    ...(payload.dueDate === null || typeof payload.dueDate !== "string" ? {} : { dueDate: payload.dueDate }),
    dueDateInferred: payload.dueDateInferred === true,
    urgency: payload.urgency === "low" || payload.urgency === "high" ? payload.urgency : "normal",
    dependencies: stringArrayFromRecord(payload, "dependencies"), recommendedNextStep: text("recommendedNextStep"),
    sourceMessageId: row.source_message_id, sourceAuthor: text("sourceAuthor"), sourceTimestamp: text("sourceTimestamp"),
    sourceSnippet: text("sourceSnippet"), sourceUrl: text("sourceUrl"), compatibilityWarning: text("compatibilityWarning"),
    contextPreview: text("contextPreview"), evidenceMessageIds: parseStringArray(row.evidence_ids_json),
    ...(responseDraft === undefined ? {} : { responseDraft }),
    ...(recommendation === undefined ? {} : { recommendation }),
    connectorEvidence: connectorEvidenceFromRecord(payload.connectorEvidence),
    connectorWarnings: stringArrayFromRecord(payload, "connectorWarnings"),
    modelName: row.model_name, analyzedAt: row.analyzed_at, stale: row.stale === 1,
  };
}

export function resolveDataDirectory(configured: string): string {
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
  return resolve(configured);
}
