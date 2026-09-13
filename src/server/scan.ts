import { randomUUID } from "node:crypto";
import type { ScanStatus } from "../shared/contracts.js";
import type { AppConfiguration } from "./config.js";
import type { SafeLogger } from "./safe-logger.js";
import type { LocalDatabase } from "./storage/database.js";
import type { IngestionBatch } from "./webex/ingestion.js";

export interface ScanTokenProvider {
  getValidAccessToken(): Promise<string>;
}

export interface MessageIngestion {
  ingestSince(roomId: string, accessToken: string, since: Date, signal?: AbortSignal): Promise<IngestionBatch>;
}

export interface SpaceAnalyzer {
  analyze(roomId: string, signal?: AbortSignal): Promise<"analyzed" | "skipped">;
}

export class ScanCoordinator {
  private current: ScanStatus = idleStatus();
  private cancellation: AbortController | null = null;

  public constructor(
    private readonly configuration: AppConfiguration,
    private readonly oauth: ScanTokenProvider,
    private readonly ingestion: MessageIngestion,
    private readonly database: LocalDatabase,
    private readonly logger: SafeLogger,
    private readonly analyzer?: SpaceAnalyzer,
  ) {}

  public status(): ScanStatus {
    return this.current;
  }

  public start(): ScanStatus {
    if (this.current.state === "running") return this.current;
    const startedAt = new Date().toISOString();
    const roomIds = this.database.selectedSpaceIds();

    const id = randomUUID();
    if (roomIds.length === 0) {
      this.current = {
        id,
        state: "complete",
        startedAt,
        finishedAt: startedAt,
        spacesTotal: 0,
        spacesCompleted: 0,
        spacesFailed: 0,
        messagesIngested: 0,
        warning: "No spaces are selected in a Watched Collection.",
      };
      return this.current;
    }
    this.cancellation = new AbortController();
    this.current = {
      id,
      state: "running",
      startedAt,
      spacesTotal: roomIds.length,
      spacesCompleted: 0,
      spacesFailed: 0,
      messagesIngested: 0,
    };
    this.logger.info("scan_started", { status: "running", spacesTotal: roomIds.length });
    void this.run(id, roomIds, this.cancellation.signal);
    return this.current;
  }

  public cancel(): ScanStatus {
    this.cancellation?.abort();
    return this.current;
  }

  private async run(id: string, roomIds: readonly string[], signal: AbortSignal): Promise<void> {
    let completed = 0;
    let failed = 0;
    let messagesIngested = 0;
    try {
      const accessToken = await this.oauth.getValidAccessToken();
      for (const roomId of roomIds) {
        if (signal.aborted) break;
        try {
          const cursor = this.database.getCursor(roomId);
          const since = cursor === null
            ? new Date(Date.now() - this.configuration.scan.initialBackfillDays * 86_400_000)
            : new Date(Date.parse(cursor.highWatermark) - this.configuration.scan.overlapMinutes * 60_000);
          const batch = await this.ingestion.ingestSince(roomId, accessToken, since, signal);
          const highWatermark = batch.highWatermark ?? new Date().toISOString();
          this.database.saveMessagesAndCursor(roomId, batch.messages, highWatermark, "complete");
          await this.analyzer?.analyze(roomId, signal);
          completed += 1;
          messagesIngested += batch.messages.length;
        } catch (error: unknown) {
          if (signal.aborted || (error instanceof Error && error.name === "AbortError")) break;
          failed += 1;
        }
        this.current = { ...this.current, spacesCompleted: completed, spacesFailed: failed, messagesIngested };
      }

      const cancelled = signal.aborted;
      const state = cancelled ? "cancelled" : failed > 0 ? "partial" : "complete";
      this.current = {
        ...this.current,
        state,
        finishedAt: new Date().toISOString(),
        spacesCompleted: completed,
        spacesFailed: failed,
        messagesIngested,
        ...(failed > 0 ? { warning: "One or more spaces could not be fully ingested or analyzed. Existing insights were preserved." } : {}),
      };
      this.logger.info("scan_completed", {
        status: state,
        spacesTotal: roomIds.length,
        spacesCompleted: completed,
        spacesFailed: failed,
        messagesIngested,
      });
      const cutoff = new Date(Date.now() - this.configuration.retention.rawMessageDays * 86_400_000).toISOString();
      this.database.purgeRawMessageTextBefore(cutoff);
      const derivedCutoff = new Date(Date.now() - this.configuration.retention.derivedInsightDays * 86_400_000).toISOString();
      this.database.purgeDerivedInsightsBefore(derivedCutoff);
    } catch (error: unknown) {
      this.current = {
        ...this.current,
        state: signal.aborted ? "cancelled" : "partial",
        finishedAt: new Date().toISOString(),
        spacesFailed: roomIds.length,
        warning: signal.aborted ? "Scan cancelled." : "Webex authorization or ingestion was unavailable.",
      };
      this.logger.error("scan_failed", {
        status: this.current.state,
        errorCode: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      if (this.current.id === id) this.cancellation = null;
    }
  }
}

function idleStatus(): ScanStatus {
  return {
    state: "idle",
    spacesTotal: 0,
    spacesCompleted: 0,
    spacesFailed: 0,
    messagesIngested: 0,
  };
}
