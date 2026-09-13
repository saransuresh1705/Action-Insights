import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIGURATION } from "../src/server/config.js";
import { AnalysisService } from "../src/server/analysis/service.js";
import { AnalysisValidationError, groundAnalysis, parseDraft, parseModelAnalysis } from "../src/server/analysis/grounding.js";
import { OpenAIResponsesModelAdapter } from "../src/server/analysis/openai.js";
import type { ModelAnalysisOutput, SpaceAnalysisInput } from "../src/server/analysis/types.js";
import type { SecretStore } from "../src/server/secrets.js";
import { LocalDatabase } from "../src/server/storage/database.js";

const input: SpaceAnalysisInput = {
  roomId: "room-1",
  spaceType: "group",
  userId: "user-private-id",
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-09-02T00:00:00.000Z",
  coverage: "complete",
  connectorEvidence: [],
  connectorWarnings: [],
  messages: [{
    id: "m1",
    authorId: "colleague-private-id",
    created: "2026-09-01T08:00:00.000Z",
    text: "Could you review the plan by 2026-09-03?",
    mentionedPeople: ["user-private-id"],
    hasAttachments: false,
  }],
};

const output: ModelAnalysisOutput = {
  summary: {
    overview: "A plan review was requested.",
    mainTopics: ["Plan review"], decisions: [], openQuestions: [], risks: [],
    userActions: ["Review the plan"], otherActions: [], importantLinks: [], noMaterialActivity: false,
    evidenceMessageIds: ["m1"],
  },
  actions: [{
    disposition: "action", primaryCategory: "Review / feedback", secondaryCategory: null,
    confidenceScore: 0.95, rationale: "USER was directly asked to review.", owner: "USER",
    dueDate: "2026-09-03", dueDateInferred: false, urgency: "normal", dependencies: [],
    recommendedNextStep: "Review the plan and provide feedback.", sourceMessageId: "m1", evidenceMessageIds: ["m1"],
    responseDraft: null,
    recommendation: {
      steps: ["Open the plan and review it against the stated goals.", "Prepare feedback for the requester."],
      missingInformation: ["The plan artifact is not included in message content."],
      completionCriteria: ["Feedback is ready for the requester."],
      facts: ["A review was requested by 2026-09-03."],
      inferences: ["The plan must be obtained before review."],
      userDecisions: ["Decide which feedback to share."],
      sideEffectingActions: ["Share feedback in the appropriate system."],
    },
    connectorEvidenceIds: [],
  }],
};

test("grounds action evidence and derives an exact local source snippet", () => {
  const result = groundAnalysis(input, "Private room", output, "gpt-5.6-sol", "2026-09-02T01:00:00.000Z");
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0]?.sourceSnippet, input.messages[0]?.text);
  assert.equal(result.actions[0]?.owner, "You");
  assert.equal(result.actions[0]?.sourceUrl.startsWith("webexteams://im?space="), true);
  assert.match(result.actions[0]?.compatibilityWarning ?? "", /not consistently supported/u);
});

test("rejects cross-space or fabricated evidence identifiers", () => {
  const invalid: ModelAnalysisOutput = {
    ...output,
    summary: { ...output.summary, evidenceMessageIds: ["other-space-message"] },
  };
  assert.throws(() => groundAnalysis(input, "Private room", invalid, "gpt-5.6-sol"), AnalysisValidationError);
});

test("parses only the versioned structured output shape", () => {
  assert.deepEqual(parseModelAnalysis(output), output);
  assert.throws(() => parseModelAnalysis({ summary: {}, actions: [] }), AnalysisValidationError);
});

test("grounds a copy-only reply draft and rejects unsupported completion claims", () => {
  const reply: ModelAnalysisOutput = {
    ...output,
    actions: [{
      ...output.actions[0]!,
      primaryCategory: "Reply required",
      responseDraft: { text: "Could you share the plan link so I can review it?", tone: "neutral", clarifyingQuestions: ["Where is the plan?"] },
      recommendation: null,
    }],
  };
  const grounded = groundAnalysis(input, "Private room", reply, "gpt-5.6-sol", "2026-09-02T01:00:00.000Z");
  assert.equal(grounded.actions[0]?.responseDraft?.tone, "neutral");
  assert.equal(grounded.actions[0]?.responseDraft?.generatedAt, "2026-09-02T01:00:00.000Z");
  assert.throws(() => parseDraft({
    text: "I have completed and approved the work.", tone: "formal", clarifyingQuestions: [],
  }), /completion claim/u);
});

test("grounds only connector evidence IDs supplied by the bounded broker", () => {
  const connectorInput: SpaceAnalysisInput = {
    ...input,
    connectorEvidence: [{
      id: "evidence-1", connector: "jira", itemId: "SAFE-12", title: "Plan review",
      status: "Open", url: "https://jira.example.test/browse/SAFE-12",
      retrievedAt: "2026-09-02T00:00:00.000Z", stale: false,
    }],
  };
  const cited: ModelAnalysisOutput = {
    ...output,
    actions: [{ ...output.actions[0]!, connectorEvidenceIds: ["evidence-1"] }],
  };
  assert.equal(groundAnalysis(connectorInput, "Private room", cited, "gpt-5.6-sol").actions[0]?.connectorEvidence[0]?.itemId, "SAFE-12");
  const fabricated: ModelAnalysisOutput = {
    ...output,
    actions: [{ ...output.actions[0]!, connectorEvidenceIds: ["fabricated"] }],
  };
  assert.throws(() => groundAnalysis(connectorInput, "Private room", fabricated, "gpt-5.6-sol"), /connector evidence/u);
});

test("OpenAI adapter applies minimized-storage controls and participant aliases", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = new OpenAIResponsesModelAdapter(DEFAULT_CONFIGURATION, "local-test-key", async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 });
  });
  assert.deepEqual(await adapter.analyze(input), output);
  assert.equal(requestBody?.store, false);
  assert.equal(requestBody?.background, false);
  assert.equal("tools" in (requestBody ?? {}), false);
  assert.equal("conversation" in (requestBody ?? {}), false);
  assert.equal("previous_response_id" in (requestBody ?? {}), false);
  assert.deepEqual(requestBody?.prompt_cache_options, { mode: "explicit" });
  const serialized = JSON.stringify(requestBody);
  assert.equal(serialized.includes("user-private-id"), false);
  assert.equal(serialized.includes("colleague-private-id"), false);
  const requestInput = requestBody?.input as Array<{ content: string }>;
  const aliased = JSON.parse(requestInput[1]?.content ?? "{}") as { messages: Array<{ author: string; mentionedPeople: string[] }> };
  assert.equal(aliased.messages[0]?.author, "P1");
  assert.deepEqual(aliased.messages[0]?.mentionedPeople, ["USER"]);
});

test("adapter retries one invalid structured result", async () => {
  let calls = 0;
  const adapter = new OpenAIResponsesModelAdapter(DEFAULT_CONFIGURATION, "local-test-key", async () => {
    calls += 1;
    return new Response(JSON.stringify({ output_text: calls === 1 ? "{}" : JSON.stringify(output) }), { status: 200 });
  });
  assert.deepEqual(await adapter.analyze(input), output);
  assert.equal(calls, 2);
});

test("adapter generates a tone-controlled draft with the same minimized-storage profile", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = new OpenAIResponsesModelAdapter(DEFAULT_CONFIGURATION, "local-test-key", async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output_text: JSON.stringify({ text: "Could you share the missing plan?", tone: "warm", clarifyingQuestions: ["Where is the plan?"] }),
    }), { status: 200 });
  });
  const draft = await adapter.generateDraft({
    tone: "warm", category: "Reply required", sourceSnippet: "Please review the plan.",
    contextPreview: "Please review the plan.", rationale: "A reply is required.", clarifyingQuestions: [],
  });
  assert.equal(draft.tone, "warm");
  assert.equal(requestBody?.store, false);
  assert.equal(requestBody?.background, false);
  assert.equal("tools" in (requestBody ?? {}), false);
});

test("analysis service requires both a local key and retention acknowledgement", async () => {
  class MemorySecrets implements SecretStore {
    public value: string | null = null;
    public async get(): Promise<string | null> { return this.value; }
    public async set(_reference: string, value: string): Promise<void> { this.value = value; }
    public async delete(): Promise<boolean> { this.value = null; return true; }
  }
  const database = LocalDatabase.inMemory(Buffer.alloc(32, 8));
  database.upsertSpaces([{ id: "room-1", title: "Private", type: "group", selected: false }], "2026-09-02T00:00:00.000Z");
  database.saveMessagesAndCursor("room-1", [{
    id: "m1", roomId: "room-1", authorId: "colleague-private-id", created: new Date().toISOString(),
    text: "Could you review the plan?", mentionedPeople: ["user-private-id"], hasAttachments: false, contentHash: "hash",
  }], new Date().toISOString(), "complete");
  const secrets = new MemorySecrets();
  let modelCalls = 0;
  const service = new AnalysisService(
    DEFAULT_CONFIGURATION,
    secrets,
    database,
    { async getCurrentUserId() { return "user-private-id"; } },
    () => ({
      async analyze() { modelCalls += 1; return output; },
      async generateDraft() { return { text: "Could you share the plan?", tone: "neutral", clarifyingQuestions: [] }; },
    }),
  );
  assert.equal(await service.analyze("room-1"), "skipped");
  secrets.value = "test-key";
  assert.equal(await service.analyze("room-1"), "skipped");
  service.acknowledgeRetention();
  assert.equal((await service.readiness()).enabled, true);
  assert.equal(await service.analyze("room-1"), "analyzed");
  assert.equal(modelCalls, 1);
  assert.equal(service.list().actions.length, 1);
  database.close();
});
