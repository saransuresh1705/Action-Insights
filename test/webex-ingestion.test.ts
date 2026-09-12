import assert from "node:assert/strict";
import test from "node:test";
import { WebexReadOnlyClient } from "../src/server/webex/client.js";
import { WebexMessageIngestionAdapter, normalizeMessage } from "../src/server/webex/ingestion.js";
import { WebexReadOnlyHttpClient } from "../src/server/webex/http.js";
import type { WebexMessage } from "../src/server/webex/types.js";

test("normalizes message evidence without retaining attachment URLs", () => {
  const message: WebexMessage = {
    id: "message-1",
    roomId: "room-1",
    text: "Please review this",
    personId: "person-1",
    created: "2026-09-12T10:00:00.000Z",
    files: ["https://webexapis.com/v1/contents/CANARY_ATTACHMENT_URL"],
  };

  const normalized = normalizeMessage(message);

  assert.equal(normalized.hasAttachments, true);
  assert.equal(JSON.stringify(normalized).includes("CANARY_ATTACHMENT_URL"), false);
  assert.match(normalized.contentHash, /^[a-f0-9]{64}$/u);
});

test("stops pagination at the cutoff and returns chronologically ordered messages", async () => {
  let requestCount = 0;
  const fetchMock: typeof fetch = async () => {
    requestCount += 1;
    return Response.json({ items: [
      { id: "new", roomId: "room-1", text: "new", created: "2026-09-12T10:00:00.000Z" },
      { id: "old", roomId: "room-1", text: "old", created: "2026-09-01T10:00:00.000Z" },
    ] }, { headers: { Link: '<https://webexapis.com/v1/messages?cursor=unused>; rel="next"' } });
  };
  const client = new WebexReadOnlyClient(new WebexReadOnlyHttpClient({ fetch: fetchMock }));
  const adapter = new WebexMessageIngestionAdapter(client);

  const batch = await adapter.ingestSince("room-1", "token", new Date("2026-09-10T00:00:00.000Z"));

  assert.equal(requestCount, 1);
  assert.deepEqual(batch.messages.map((message) => message.id), ["new"]);
  assert.equal(batch.highWatermark, "2026-09-12T10:00:00.000Z");
});
