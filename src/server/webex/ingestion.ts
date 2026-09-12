import { createHash } from "node:crypto";
import type { WebexReadOnlyClient } from "./client.js";
import type { NormalizedWebexMessage, WebexMessage } from "./types.js";

export interface IngestionBatch {
  readonly roomId: string;
  readonly messages: readonly NormalizedWebexMessage[];
  readonly highWatermark?: string;
  readonly pagesRead: number;
}

export class WebexMessageIngestionAdapter {
  public constructor(private readonly client: WebexReadOnlyClient) {}

  public async ingestSince(
    roomId: string,
    accessToken: string,
    since: Date,
    signal?: AbortSignal,
  ): Promise<IngestionBatch> {
    const byIdAndVersion = new Map<string, NormalizedWebexMessage>();
    let pagesRead = 0;

    await this.client.listMessagePages(
      roomId,
      accessToken,
      (page) => {
        pagesRead += 1;
        let reachedBoundary = false;
        for (const message of page) {
          const created = Date.parse(message.created);
          if (!Number.isFinite(created)) continue;
          if (created < since.getTime()) {
            reachedBoundary = true;
            continue;
          }
          const normalized = normalizeMessage(message);
          byIdAndVersion.set(`${normalized.id}:${normalized.contentHash}`, normalized);
        }
        return !reachedBoundary;
      },
      signal,
    );

    const messages = [...byIdAndVersion.values()].sort((left, right) => Date.parse(left.created) - Date.parse(right.created));
    const highWatermark = messages.at(-1)?.created;
    return highWatermark === undefined
      ? { roomId, messages, pagesRead }
      : { roomId, messages, highWatermark, pagesRead };
  }
}

export function normalizeMessage(message: WebexMessage): NormalizedWebexMessage {
  const text = message.text ?? message.markdown ?? message.html ?? "";
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        id: message.id,
        roomId: message.roomId,
        parentId: message.parentId ?? null,
        text,
        updated: message.updated ?? null,
        mentionedPeople: message.mentionedPeople ?? [],
        hasAttachments: (message.files?.length ?? 0) > 0,
      }),
    )
    .digest("hex");

  return {
    id: message.id,
    roomId: message.roomId,
    ...(message.parentId === undefined ? {} : { parentId: message.parentId }),
    ...(message.personId === undefined ? {} : { authorId: message.personId }),
    created: message.created,
    ...(message.updated === undefined ? {} : { updated: message.updated }),
    text,
    mentionedPeople: message.mentionedPeople ?? [],
    hasAttachments: (message.files?.length ?? 0) > 0,
    contentHash,
  };
}

