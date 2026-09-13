import { createHash } from "node:crypto";
import type { ConnectorCatalog, ConnectorEvidenceView } from "../../shared/contracts.js";
import type { AppConfiguration } from "../config.js";
import { evaluateOperation, type OperationKind } from "../policy.js";
import type { SecretStore } from "../secrets.js";
import type { AnalysisInputMessage } from "../analysis/types.js";
import { JiraReadOnlyClient } from "./jira.js";
import type { ConnectorCollectionResult, ConnectorEvidenceProvider, JiraIssueRecord } from "./types.js";

const DENIED_OPERATION_KINDS = ["WRITE", "SEND", "DELETE", "APPROVE", "MERGE", "TRANSITION", "INVITE", "RUN"] as const;
const JIRA_KEY = /\b([A-Z][A-Z0-9_]{1,19}-[1-9][0-9]{0,11})\b/gu;
const PROMPT_INJECTION = /\b(?:ignore|override|disregard)\b.{0,80}\b(?:instructions?|rules?|policy|guardrails?)\b|\b(?:system|developer|assistant)\s*:/iu;

export class ConnectorPolicyError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ConnectorPolicyError";
  }
}

export class ReadOnlyConnectorBroker implements ConnectorEvidenceProvider {
  private readonly jira: JiraReadOnlyClient;

  public constructor(
    private readonly configuration: AppConfiguration,
    private readonly secrets: SecretStore,
    jira?: JiraReadOnlyClient,
  ) {
    this.jira = jira ?? new JiraReadOnlyClient(configuration.connectors.jira);
  }

  public async status(): Promise<ConnectorCatalog> {
    const config = this.configuration.connectors.jira;
    const credentialConfigured = await this.secrets.get(config.credentialRef) !== null;
    return {
      connectors: [{
        id: "jira",
        label: "Jira",
        enabled: config.enabled,
        credentialConfigured,
        allowedOperations: ["get_issue"],
        allowedProjects: config.allowedProjects,
        maxCallsPerAnalysis: config.maxCallsPerAnalysis,
        writesAllowed: false,
        message: !config.enabled
          ? "Disabled in local configuration."
          : credentialConfigured
            ? "Ready for allow-listed, read-only issue lookups."
            : "Enabled, but the configured macOS Keychain credential is missing.",
      }],
      deniedOperationKinds: DENIED_OPERATION_KINDS,
    };
  }

  public async collect(messages: readonly AnalysisInputMessage[], signal?: AbortSignal): Promise<ConnectorCollectionResult> {
    const config = this.configuration.connectors.jira;
    if (!config.enabled) return { evidence: [], warnings: [] };
    this.assertOperation("READ");
    const keys = extractJiraKeys(messages)
      .filter((key) => config.allowedProjects.includes(key.split("-")[0] ?? ""))
      .slice(0, config.maxCallsPerAnalysis);
    if (keys.length === 0) return { evidence: [], warnings: [] };
    const token = await this.secrets.get(config.credentialRef);
    if (token === null) return { evidence: [], warnings: ["Jira evidence was not retrieved because its Keychain credential is missing."] };
    const evidence: ConnectorEvidenceView[] = [];
    const warnings: string[] = [];
    for (const key of keys) {
      try {
        const issue = await this.jira.getIssue(key, token, signal);
        const normalized = normalizeIssue(issue);
        if (normalized === null) {
          warnings.push(`Jira ${key} was withheld because its content resembled an instruction to the agent.`);
        } else {
          evidence.push(normalized);
        }
      } catch {
        warnings.push(`Jira ${key} could not be retrieved with the configured read-only connector.`);
      }
    }
    return { evidence, warnings };
  }

  public assertOperation(kind: OperationKind): void {
    const decision = evaluateOperation(kind);
    if (!decision.allowed) throw new ConnectorPolicyError(decision.code, decision.reason);
  }
}

export function extractJiraKeys(messages: readonly AnalysisInputMessage[]): readonly string[] {
  const keys = new Set<string>();
  for (const message of messages) {
    for (const match of message.text.toUpperCase().matchAll(JIRA_KEY)) {
      if (match[1] !== undefined) keys.add(match[1]);
    }
  }
  return [...keys];
}

function normalizeIssue(issue: JiraIssueRecord, now = new Date()): ConnectorEvidenceView | null {
  if (PROMPT_INJECTION.test(issue.title) || PROMPT_INJECTION.test(issue.status)) return null;
  const retrievedAt = now.toISOString();
  const updated = issue.updatedAt === undefined ? Number.NaN : Date.parse(issue.updatedAt);
  return {
    id: createHash("sha256").update(`jira:${issue.key}`).digest("hex").slice(0, 32),
    connector: "jira",
    itemId: issue.key,
    title: issue.title.slice(0, 300),
    status: issue.status.slice(0, 120),
    url: issue.url,
    retrievedAt,
    stale: !Number.isFinite(updated) || now.getTime() - updated > 30 * 86_400_000,
  };
}
