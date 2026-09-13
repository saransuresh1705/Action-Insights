export const APP_NAME = "Webex Action Insights";
export const APP_VERSION = "0.3.0";

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

export interface HealthResponse {
  readonly status: "ok";
  readonly service: typeof APP_NAME;
  readonly version: string;
  readonly now: string;
}

export interface ApiError {
  readonly error: string;
}
