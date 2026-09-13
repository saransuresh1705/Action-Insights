export const APP_NAME = "Webex Action Insights";
export const APP_VERSION = "0.5.0";

export type ReasoningEffort = "medium" | "high";

export interface PublicConfiguration {
  readonly timezone: string;
  readonly scanIntervalMinutes: number;
  readonly initialBackfillDays: number;
  readonly rawMessageRetentionDays: number;
  readonly derivedInsightRetentionDays: number;
  readonly modelName: string;
  readonly modelEnabled: boolean;
  readonly directMessagesIncluded: boolean;
  readonly catalogActivityWindowDays: number | null;
  readonly backgroundServiceEnabled: false;
  readonly externalWritesEnabled: false;
}

export type WebexTokenHealth = "not-configured" | "disconnected" | "healthy" | "expired" | "error";

export interface WebexIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly emails: readonly string[];
}

export interface WebexConnectionStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly tokenHealth: WebexTokenHealth;
  readonly expiresAt?: string;
  readonly grantedScopes: readonly string[];
  readonly identity?: WebexIdentity;
}

export interface WebexAuthorizationStart {
  readonly authorizationUrl: string;
}

export interface WebexSpaceSummary {
  readonly id: string;
  readonly title: string;
  readonly type: "direct" | "group";
  readonly lastActivity?: string;
  readonly selected: boolean;
  readonly activityWindowStatus?: "within-window" | "outside-window" | "unknown";
}

export interface WebexSpaceCatalog {
  readonly spaces: readonly WebexSpaceSummary[];
  readonly retrievedAt: string;
  readonly activityWindowDays: number | null;
  readonly totalSpaces: number;
  readonly excludedSpaces: number;
}

export interface WatchedCollectionView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly spaceIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WatchedCollectionCatalog {
  readonly collections: readonly WatchedCollectionView[];
}

export type ScanState = "idle" | "running" | "complete" | "partial" | "cancelled";

export interface ScanStatus {
  readonly id?: string;
  readonly state: ScanState;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly spacesTotal: number;
  readonly spacesCompleted: number;
  readonly spacesFailed: number;
  readonly messagesIngested: number;
  readonly warning?: string;
}

export interface SchedulerStatus {
  readonly active: boolean;
  readonly intervalMinutes: number;
  readonly nextRunAt?: string;
  readonly mode: "app-open";
}

export const ACTION_CATEGORIES = [
  "Reply required",
  "Acknowledgement",
  "Decision / approval",
  "Review / feedback",
  "External work item",
  "Research / information",
  "Meeting / scheduling",
  "Follow-up / reminder",
  "Blocker / dependency",
  "Risk / escalation",
  "Delegation candidate",
  "FYI / no action",
  "Ambiguous",
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];
export type ActionStatus = "New" | "Reviewed" | "In progress" | "Snoozed" | "Resolved" | "Dismissed" | "Not mine";
export type ConfidenceLevel = "High" | "Medium" | "Low";
export type ResponseTone = "concise" | "neutral" | "warm" | "formal";

export interface ResponseDraftView {
  readonly text: string;
  readonly tone: ResponseTone;
  readonly clarifyingQuestions: readonly string[];
  readonly generatedAt: string;
}

export interface ActionRecommendationView {
  readonly steps: readonly string[];
  readonly missingInformation: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly facts: readonly string[];
  readonly inferences: readonly string[];
  readonly userDecisions: readonly string[];
  readonly sideEffectingActions: readonly string[];
}

export interface ConnectorEvidenceView {
  readonly id: string;
  readonly connector: "jira";
  readonly itemId: string;
  readonly title: string;
  readonly status: string;
  readonly url: string;
  readonly retrievedAt: string;
  readonly stale: boolean;
}

export interface ConnectorStatusView {
  readonly id: "jira";
  readonly label: "Jira";
  readonly enabled: boolean;
  readonly credentialConfigured: boolean;
  readonly allowedOperations: readonly ["get_issue"];
  readonly allowedProjects: readonly string[];
  readonly maxCallsPerAnalysis: number;
  readonly writesAllowed: false;
  readonly message: string;
}

export interface ConnectorCatalog {
  readonly connectors: readonly ConnectorStatusView[];
  readonly deniedOperationKinds: readonly ["WRITE", "SEND", "DELETE", "APPROVE", "MERGE", "TRANSITION", "INVITE", "RUN"];
}

export interface AnalysisReadiness {
  readonly modelName: string;
  readonly credentialConfigured: boolean;
  readonly retentionAcknowledged: boolean;
  readonly enabled: boolean;
  readonly disclosureUrl: string;
}

export interface SpaceSummaryView {
  readonly id: string;
  readonly roomId: string;
  readonly spaceTitle: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly coverage: "complete" | "partial";
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
  readonly modelName: string;
  readonly analyzedAt: string;
  readonly stale: boolean;
}

export interface ActionCandidateView {
  readonly id: string;
  readonly roomId: string;
  readonly spaceTitle: string;
  readonly collectionNames: readonly string[];
  readonly category: ActionCategory;
  readonly secondaryCategory?: ActionCategory;
  readonly status: ActionStatus;
  readonly confidence: ConfidenceLevel;
  readonly confidenceScore: number;
  readonly rationale: string;
  readonly owner: string;
  readonly dueDate?: string;
  readonly dueDateInferred: boolean;
  readonly urgency: "low" | "normal" | "high";
  readonly dependencies: readonly string[];
  readonly recommendedNextStep: string;
  readonly sourceMessageId: string;
  readonly sourceAuthor: string;
  readonly sourceTimestamp: string;
  readonly sourceSnippet: string;
  readonly sourceUrl: string;
  readonly compatibilityWarning: string;
  readonly contextPreview: string;
  readonly evidenceMessageIds: readonly string[];
  readonly responseDraft?: ResponseDraftView;
  readonly recommendation?: ActionRecommendationView;
  readonly connectorEvidence: readonly ConnectorEvidenceView[];
  readonly connectorWarnings: readonly string[];
  readonly modelName: string;
  readonly analyzedAt: string;
  readonly stale: boolean;
}

export interface InsightDashboard {
  readonly summaries: readonly SpaceSummaryView[];
  readonly actions: readonly ActionCandidateView[];
}

export interface ActionFeedbackInput {
  readonly status?: ActionStatus;
  readonly category?: ActionCategory;
  readonly owner?: string;
  readonly dueDate?: string | null;
  readonly confidence?: ConfidenceLevel;
}

export interface HealthResponse {
  readonly status: "ok";
  readonly service: typeof APP_NAME;
  readonly version: string;
  readonly now: string;
}

export interface ApiError {
  readonly error: string;
}
