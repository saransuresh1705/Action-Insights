import assert from "node:assert/strict";
import test from "node:test";
import type { WebexSpaceSummary } from "../src/shared/contracts.js";
import { filterSpaceCatalog } from "../src/server/webex/service.js";

const now = new Date("2026-09-13T12:00:00.000Z");
const spaces: readonly WebexSpaceSummary[] = [
  { id: "recent-group", title: "Recent group", type: "group", lastActivity: "2026-08-15T12:00:00.000Z", selected: false },
  { id: "cutoff-direct", title: "Cutoff direct", type: "direct", lastActivity: "2026-08-14T12:00:00.000Z", selected: false },
  { id: "old-selected", title: "Old selected", type: "group", lastActivity: "2026-07-01T12:00:00.000Z", selected: false },
  { id: "old-unselected", title: "Old unselected", type: "direct", lastActivity: "2026-07-01T12:00:00.000Z", selected: false },
  { id: "unknown-selected", title: "Unknown selected", type: "direct", selected: false },
  { id: "unknown-unselected", title: "Unknown unselected", type: "group", selected: false },
];

test("filters group and direct spaces at the rolling cutoff while preserving selected older spaces", () => {
  const result = filterSpaceCatalog(spaces, new Set(["old-selected", "unknown-selected"]), 30, now);

  assert.deepEqual(result.map((space) => space.id), ["recent-group", "cutoff-direct", "old-selected", "unknown-selected"]);
  assert.equal(result.find((space) => space.id === "old-selected")?.activityWindowStatus, "outside-window");
  assert.equal(result.find((space) => space.id === "old-selected")?.selected, true);
  assert.equal(result.find((space) => space.id === "unknown-selected")?.activityWindowStatus, "unknown");
});

test("explicit all-activity mode includes spaces with old or unknown activity", () => {
  const result = filterSpaceCatalog(spaces, new Set<string>(), null, now);

  assert.equal(result.length, spaces.length);
  assert.equal(result.find((space) => space.id === "unknown-unselected")?.activityWindowStatus, "unknown");
});
