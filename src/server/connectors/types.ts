import type { ConnectorEvidenceView } from "../../shared/contracts.js";
import type { AnalysisInputMessage } from "../analysis/types.js";

export interface ConnectorCollectionResult {
  readonly evidence: readonly ConnectorEvidenceView[];
  readonly warnings: readonly string[];
}

export interface ConnectorEvidenceProvider {
  collect(messages: readonly AnalysisInputMessage[], signal?: AbortSignal): Promise<ConnectorCollectionResult>;
}

export interface JiraIssueRecord {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt?: string;
  readonly url: string;
}
