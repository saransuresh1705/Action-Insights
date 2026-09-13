import { createHash } from "node:crypto";
import {
  ACTION_CATEGORIES,
  type ActionCandidateView,
  type ConfidenceLevel,
  type SpaceSummaryView,
} from "../../shared/contracts.js";
import type { ModelActionOutput, ModelAnalysisOutput, SpaceAnalysisInput } from "./types.js";

export class AnalysisValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AnalysisValidationError";
  }
}

export interface GroundedInsights {
  readonly summary: SpaceSummaryView;
  readonly actions: readonly ActionCandidateView[];
}

export function groundAnalysis(
  input: SpaceAnalysisInput,
  spaceTitle: string,
  output: ModelAnalysisOutput,
  modelName: string,
  analyzedAt = new Date().toISOString(),
): GroundedInsights {
  const messages = new Map(input.messages.map((message) => [message.id, message]));
  validateIds(output.summary.evidenceMessageIds, messages, "summary");
  const summaryId = digest(`${input.roomId}:${input.periodStart}:${input.periodEnd}`);
  const summary: SpaceSummaryView = {
    id: summaryId,
    roomId: input.roomId,
    spaceTitle,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    coverage: input.coverage,
    ...output.summary,
    modelName,
    analyzedAt,
    stale: false,
  };

  const seen = new Set<string>();
  const actions: ActionCandidateView[] = [];
  for (const candidate of output.actions) {
    if (candidate.disposition === "no_action") continue;
    validateCandidate(candidate, messages);
    const source = messages.get(candidate.sourceMessageId) as SpaceAnalysisInput["messages"][number];
    const id = digest(`${input.roomId}:${candidate.sourceMessageId}:${candidate.primaryCategory}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const confidence = confidenceLevel(candidate.confidenceScore, candidate.disposition);
    actions.push({
      id,
      roomId: input.roomId,
      spaceTitle,
      collectionNames: [],
      category: candidate.primaryCategory,
      ...(candidate.secondaryCategory === null ? {} : { secondaryCategory: candidate.secondaryCategory }),
      status: "New",
      confidence,
      confidenceScore: candidate.confidenceScore,
      rationale: candidate.rationale,
      owner: "You",
      ...(candidate.dueDate === null ? {} : { dueDate: candidate.dueDate }),
      dueDateInferred: candidate.dueDateInferred,
      urgency: candidate.urgency,
      dependencies: candidate.dependencies,
      recommendedNextStep: candidate.recommendedNextStep,
      sourceMessageId: source.id,
      sourceAuthor: source.authorId === input.userId ? "You" : participantLabel(source.authorId),
      sourceTimestamp: source.created,
      sourceSnippet: source.text.slice(0, 320),
      sourceUrl: `webexteams://im?space=${encodeURIComponent(input.roomId)}`,
      compatibilityWarning: "Webex message-level deep links are not consistently supported. This opens the space; use the timestamp, author, snippet, and source reference to locate the message.",
      contextPreview: contextPreview(input, source.id),
      evidenceMessageIds: candidate.evidenceMessageIds,
      modelName,
      analyzedAt,
      stale: false,
    });
  }
  return { summary, actions };
}

export function parseModelAnalysis(value: unknown): ModelAnalysisOutput {
  const root = record(value, "analysis");
  onlyKeys(root, ["summary", "actions"], "analysis");
  const summary = record(root.summary, "summary");
  onlyKeys(summary, ["overview", "mainTopics", "decisions", "openQuestions", "risks", "userActions", "otherActions", "importantLinks", "noMaterialActivity", "evidenceMessageIds"], "summary");
  const actions = array(root.actions, "actions").map((entry, index) => parseAction(entry, index));
  return {
    summary: {
      overview: string(summary.overview, "summary.overview"),
      mainTopics: strings(summary.mainTopics, "summary.mainTopics"),
      decisions: strings(summary.decisions, "summary.decisions"),
      openQuestions: strings(summary.openQuestions, "summary.openQuestions"),
      risks: strings(summary.risks, "summary.risks"),
      userActions: strings(summary.userActions, "summary.userActions"),
      otherActions: strings(summary.otherActions, "summary.otherActions"),
      importantLinks: strings(summary.importantLinks, "summary.importantLinks"),
      noMaterialActivity: boolean(summary.noMaterialActivity, "summary.noMaterialActivity"),
      evidenceMessageIds: strings(summary.evidenceMessageIds, "summary.evidenceMessageIds"),
    },
    actions,
  };
}

function parseAction(value: unknown, index: number): ModelActionOutput {
  const item = record(value, `actions[${index}]`);
  onlyKeys(item, ["disposition", "primaryCategory", "secondaryCategory", "confidenceScore", "rationale", "owner", "dueDate", "dueDateInferred", "urgency", "dependencies", "recommendedNextStep", "sourceMessageId", "evidenceMessageIds"], `actions[${index}]`);
  const disposition = enumValue(item.disposition, ["action", "needs_review", "no_action"] as const, "disposition");
  const primaryCategory = enumValue(item.primaryCategory, ACTION_CATEGORIES, "primaryCategory");
  const secondaryCategory = item.secondaryCategory === null
    ? null
    : enumValue(item.secondaryCategory, ACTION_CATEGORIES, "secondaryCategory");
  const confidenceScore = number(item.confidenceScore, "confidenceScore");
  if (confidenceScore < 0 || confidenceScore > 1) throw new AnalysisValidationError("confidenceScore is out of range");
  const dueDate = item.dueDate === null ? null : string(item.dueDate, "dueDate");
  if (dueDate !== null && !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(dueDate)) throw new AnalysisValidationError("dueDate must be ISO formatted");
  return {
    disposition,
    primaryCategory,
    secondaryCategory,
    confidenceScore,
    rationale: string(item.rationale, "rationale"),
    owner: string(item.owner, "owner"),
    dueDate,
    dueDateInferred: boolean(item.dueDateInferred, "dueDateInferred"),
    urgency: enumValue(item.urgency, ["low", "normal", "high"] as const, "urgency"),
    dependencies: strings(item.dependencies, "dependencies"),
    recommendedNextStep: string(item.recommendedNextStep, "recommendedNextStep"),
    sourceMessageId: string(item.sourceMessageId, "sourceMessageId"),
    evidenceMessageIds: strings(item.evidenceMessageIds, "evidenceMessageIds"),
  };
}

function validateCandidate(candidate: ModelActionOutput, messages: ReadonlyMap<string, unknown>): void {
  if (candidate.primaryCategory === "FYI / no action") throw new AnalysisValidationError("FYI cannot be surfaced as an action");
  if (candidate.owner !== "USER") throw new AnalysisValidationError("Action owner is not grounded to USER");
  validateIds(candidate.evidenceMessageIds, messages, "action");
  if (!messages.has(candidate.sourceMessageId)) throw new AnalysisValidationError("Action source message is invalid");
  if (!candidate.evidenceMessageIds.includes(candidate.sourceMessageId)) {
    throw new AnalysisValidationError("Action source message must be included as evidence");
  }
  if (candidate.dueDate === null && candidate.dueDateInferred) {
    throw new AnalysisValidationError("A missing due date cannot be marked inferred");
  }
}

function validateIds(ids: readonly string[], messages: ReadonlyMap<string, unknown>, label: string): void {
  if (ids.some((id) => !messages.has(id))) throw new AnalysisValidationError(`${label} contains an invalid evidence ID`);
}

function confidenceLevel(score: number, disposition: ModelActionOutput["disposition"]): ConfidenceLevel {
  if (disposition === "needs_review" || score < 0.6) return "Low";
  if (score < 0.82) return "Medium";
  return "High";
}

function participantLabel(authorId: string | undefined): string {
  return authorId === undefined ? "Unknown participant" : `Participant ${digest(authorId).slice(0, 6)}`;
}

function contextPreview(input: SpaceAnalysisInput, sourceId: string): string {
  const index = input.messages.findIndex((message) => message.id === sourceId);
  return input.messages.slice(Math.max(0, index - 1), index + 2)
    .map((message) => `${message.created} · ${message.text.slice(0, 180)}`).join("\n");
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AnalysisValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new AnalysisValidationError(`${label} contains unsupported fields`);
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new AnalysisValidationError(`${label} must be an array`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new AnalysisValidationError(`${label} must be a string`);
  return value;
}
function strings(value: unknown, label: string): readonly string[] {
  const values = array(value, label);
  if (!values.every((entry) => typeof entry === "string")) throw new AnalysisValidationError(`${label} must contain strings`);
  return values as string[];
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new AnalysisValidationError(`${label} must be a boolean`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AnalysisValidationError(`${label} must be a finite number`);
  return value;
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new AnalysisValidationError(`${label} is invalid`);
  return value as T;
}
