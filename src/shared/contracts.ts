export const APP_NAME = "Webex Action Insights";

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
  readonly backgroundServiceEnabled: false;
  readonly externalWritesEnabled: false;
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
