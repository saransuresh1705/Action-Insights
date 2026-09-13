import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIGURATION } from "../src/server/config.js";
import { SafeLogger } from "../src/server/safe-logger.js";
import { ScanCoordinator, type MessageIngestion } from "../src/server/scan.js";
import { LocalDatabase } from "../src/server/storage/database.js";

test("scans only spaces selected through Watched Collections and advances cursors", async () => {
  const database = LocalDatabase.inMemory(Buffer.alloc(32, 3));
  database.upsertSpaces([
    { id: "selected-room", title: "Selected", type: "group", selected: false },
    { id: "unselected-room", title: "Unselected", type: "group", selected: false },
  ], "2026-09-12T00:00:00.000Z");
  database.createCollection("collection-1", "Priorities");
  database.replaceCollectionSpaces("collection-1", ["selected-room"]);
  const requestedRooms: string[] = [];
  const analyzedRooms: string[] = [];
  const ingestion: MessageIngestion = {
    async ingestSince(roomId) {
      requestedRooms.push(roomId);
      return {
        roomId,
        pagesRead: 1,
        highWatermark: "2026-09-12T10:00:00.000Z",
        messages: [{
          id: "message-1",
          roomId,
          created: "2026-09-12T10:00:00.000Z",
          text: "retained encrypted",
          mentionedPeople: [],
          hasAttachments: false,
          contentHash: "hash-1",
        }],
      };
    },
  };
  const coordinator = new ScanCoordinator(
    DEFAULT_CONFIGURATION,
    { async getValidAccessToken() { return "server-only-token"; } },
    ingestion,
    database,
    new SafeLogger(() => undefined),
    { async analyze(roomId) { analyzedRooms.push(roomId); return "analyzed"; } },
  );

  coordinator.start();
  await waitForFinished(coordinator);

  assert.deepEqual(requestedRooms, ["selected-room"]);
  assert.deepEqual(analyzedRooms, ["selected-room"]);
  assert.equal(coordinator.status().state, "complete");
  assert.equal(coordinator.status().messagesIngested, 1);
  assert.equal(database.getCursor("selected-room")?.highWatermark, "2026-09-12T10:00:00.000Z");
  assert.equal(database.getCursor("unselected-room"), null);
  database.close();
});

async function waitForFinished(coordinator: ScanCoordinator): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (coordinator.status().state !== "running") return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Scan did not finish during the test");
}
