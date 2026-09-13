import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("specification 1.2 separates focused insights from settings configuration", async () => {
  const html = await readFile("public/index.html", "utf8");
  const insightsStart = html.indexOf('id="insights-view"');
  const settingsStart = html.indexOf('id="settings-view"');
  assert.ok(insightsStart > 0);
  assert.ok(settingsStart > insightsStart);
  const insights = html.slice(insightsStart, settingsStart);
  const settings = html.slice(settingsStart);

  for (const id of ["scan-now", "scan-status", "action-list", "summary-list"]) {
    assert.match(insights, new RegExp(`id="${id}"`, "u"));
    assert.doesNotMatch(settings, new RegExp(`id="${id}"`, "u"));
  }
  for (const id of ["model-setup", "webex-connect", "catalog-activity-window", "collection-select", "space-list", "model-status"]) {
    assert.match(settings, new RegExp(`id="${id}"`, "u"));
    assert.doesNotMatch(insights, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(settings, /id="space-tab-direct"[^>]+role="tab"/u);
  assert.match(settings, /id="space-tab-group"[^>]+role="tab"/u);
  assert.match(html, /id="view-toggle"[^>]+aria-controls="settings-view"/u);
  assert.match(html, /specification 1\.2/u);
  assert.match(settings, /id="connectors-settings"/u);
  assert.match(settings, /Jira read-only/u);

  const client = await readFile("src/client/app.ts", "utf8");
  assert.match(client, /Review response draft/u);
  assert.match(client, /Copy response/u);
  assert.match(client, /Review recommended action plan/u);
  assert.doesNotMatch(html, />\s*(?:Send|Post|Reply|Execute)\s*</u);
});
