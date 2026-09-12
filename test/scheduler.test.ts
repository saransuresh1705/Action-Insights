import assert from "node:assert/strict";
import test from "node:test";
import type { ScanStatus } from "../src/shared/contracts.js";
import type { ScanFacade } from "../src/server/http-server.js";
import { AppOpenScheduler } from "../src/server/scheduler.js";

test("runs one catch-up scan after app start and schedules the configured interval", () => {
  let callback: (() => void) | undefined;
  let delay = -1;
  let starts = 0;
  const idle: ScanStatus = {
    state: "idle",
    spacesTotal: 0,
    spacesCompleted: 0,
    spacesFailed: 0,
    messagesIngested: 0,
  };
  const scans: ScanFacade = {
    status() { return idle; },
    start() { starts += 1; return idle; },
    cancel() { return idle; },
  };
  const scheduler = new AppOpenScheduler(60, scans, {
    now: () => Date.parse("2026-09-12T10:00:00.000Z"),
    initialDelayMilliseconds: 1_000,
    setTimer(next, milliseconds) {
      callback = next;
      delay = milliseconds;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer() {},
  });

  scheduler.start();
  assert.equal(delay, 1_000);
  assert.equal(scheduler.status().nextRunAt, "2026-09-12T10:00:01.000Z");
  callback?.();
  assert.equal(starts, 1);
  assert.equal(delay, 3_600_000);
  assert.equal(scheduler.status().nextRunAt, "2026-09-12T11:00:00.000Z");
  scheduler.stop();
  assert.equal(scheduler.status().active, false);
});
