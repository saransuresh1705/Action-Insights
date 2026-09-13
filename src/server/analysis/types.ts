import type { ActionCategory } from "../../shared/contracts.js";

export interface AnalysisInputMessage {
  readonly id: string;
  readonly parentId?: string;
  readonly authorId?: string;
  readonly created: string;
  readonly text: string;
  readonly mentionedPeople: readonly string[];
  readonly hasAttachments: boolean;
}

export interface SpaceAnalysisInput {
  readonly roomId: string;
  readonly spaceType: "direct" | "group";
  readonly userId: string;
  readonly messages: readonly AnalysisInputMessage[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly coverage: "complete" | "partial";
}

export interface ModelSummaryOutput {
  readonly overview: string;
  readonly mainTopics: readonly string[];
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly risks: readonly string[];
  readonly userActions: readonly string[];
  readonly otherActions: readonly string[];
  readonly importantLinks: readonly string[];
  readonly noMaterialActivity: boolean;
  readonly evidenceMessageIds: readonly string[];
}

export interface ModelActionOutput {
  readonly disposition: "action" | "needs_review" | "no_action";
  readonly primaryCategory: ActionCategory;
  readonly secondaryCategory: ActionCategory | null;
  readonly confidenceScore: number;
  readonly rationale: string;
  readonly owner: string;
  readonly dueDate: string | null;
  readonly dueDateInferred: boolean;
  readonly urgency: "low" | "normal" | "high";
  readonly dependencies: readonly string[];
  readonly recommendedNextStep: string;
  readonly sourceMessageId: string;
  readonly evidenceMessageIds: readonly string[];
}

export interface ModelAnalysisOutput {
  readonly summary: ModelSummaryOutput;
  readonly actions: readonly ModelActionOutput[];
}

export interface ModelAdapter {
  analyze(input: SpaceAnalysisInput, signal?: AbortSignal): Promise<ModelAnalysisOutput>;
}
