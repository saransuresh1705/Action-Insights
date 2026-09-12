import assert from "node:assert/strict";
import test from "node:test";
import { CollectionService } from "../src/server/collections.js";
import { LocalDatabase } from "../src/server/storage/database.js";

test("creates Watched Collections and validates local-only space selection", () => {
  const database = LocalDatabase.inMemory(Buffer.alloc(32, 5));
  database.upsertSpaces([{
    id: "room-1",
    title: "Test space",
    type: "group",
    selected: false,
  }], "2026-09-12T00:00:00.000Z");
  const service = new CollectionService(database);

  const collection = service.create({ name: "My priorities" });
  const updated = service.replaceSpaces(collection.id, { spaceIds: ["room-1", "room-1"] });

  assert.deepEqual(updated.spaceIds, ["room-1"]);
  assert.equal(service.list().collections[0]?.name, "My priorities");
  assert.throws(() => service.create({ name: "" }), /invalid/);
  assert.throws(() => service.replaceSpaces(collection.id, { spaceIds: ["missing-room"] }));
  database.close();
});
