import assert from "node:assert/strict";
import test from "node:test";
import { SafeLogger } from "../src/server/safe-logger.js";

test("drops message and identity content from structured logs", () => {
  const lines: string[] = [];
  const logger = new SafeLogger((line) => lines.push(line));
  const canaries = [
    "CANARY_MESSAGE_BODY_91f2",
    "CANARY_PERSON_NAME_8a3d",
    "CANARY_EMAIL_7b1c@example.test",
    "CANARY_SPACE_TITLE_4e5f",
    "CANARY_SECRET_2d6a",
  ];

  logger.info("http_request", {
    route: "/api/health",
    httpStatus: 200,
    message: canaries[0],
    personName: canaries[1],
    email: canaries[2],
    spaceTitle: canaries[3],
    token: canaries[4],
  });

  assert.equal(lines.length, 1);
  for (const canary of canaries) {
    assert.equal(lines[0]?.includes(canary), false);
  }
  assert.match(lines[0] ?? "", /"httpStatus":200/);
});

test("replaces unapproved event names so content cannot leak through the event field", () => {
  const lines: string[] = [];
  const logger = new SafeLogger((line) => lines.push(line));
  const canary = "CANARY_MESSAGE_AS_EVENT_55af";

  logger.error(canary, { errorCode: "SAFE_CODE" });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes(canary), false);
  assert.match(lines[0] ?? "", /"event":"unknown_event"/);
  assert.match(lines[0] ?? "", /"errorCode":"SAFE_CODE"/);
});

test("rejects unsafe values even when they use an allow-listed field name", () => {
  const lines: string[] = [];
  const logger = new SafeLogger((line) => lines.push(line));

  logger.info("scan_completed", {
    status: "CANARY_MESSAGE_SMUGGLED_IN_STATUS",
    errorCode: "CANARY MESSAGE WITH SPACES",
    spacesTotal: 3,
  });

  assert.equal(lines[0]?.includes("CANARY"), false);
  assert.match(lines[0] ?? "", /"spacesTotal":3/);
});
