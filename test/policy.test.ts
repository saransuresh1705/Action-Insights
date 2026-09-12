import assert from "node:assert/strict";
import test from "node:test";
import { evaluateOperation, OPERATION_KINDS } from "../src/server/policy.js";

test("allows only read and local draft operations", () => {
  const allowed = OPERATION_KINDS.filter((kind) => evaluateOperation(kind).allowed);
  assert.deepEqual(allowed, ["READ", "DRAFT"]);
});

test("denies every release-1 side-effect operation", () => {
  const deniedKinds = ["WRITE", "SEND", "DELETE", "APPROVE", "MERGE", "TRANSITION", "INVITE", "RUN"] as const;

  for (const kind of deniedKinds) {
    const decision = evaluateOperation(kind);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "release-1-side-effect-denied");
  }
});
