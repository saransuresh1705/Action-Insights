import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release-1 synthetic evaluation corpus is complete and contains no obvious credentials", async () => {
  const lines = (await readFile("evaluation/corpus.v1.jsonl", "utf8")).trim().split("\n");
  assert.equal(lines.length, 64);
  const ids = new Set<string>();
  for (const line of lines) {
    const entry = JSON.parse(line) as Record<string, unknown>;
    assert.equal(typeof entry.id, "string");
    ids.add(entry.id as string);
    assert.equal(Array.isArray(entry.messages), true);
    assert.equal(typeof entry.expected, "object");
    assert.doesNotMatch(line, /(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/u);
  }
  assert.equal(ids.size, lines.length);
});
