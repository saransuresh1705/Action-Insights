import type {
  ActionFeedbackInput,
  AnalysisReadiness,
  InsightDashboard,
} from "../../shared/contracts.js";
import type { AppConfiguration } from "../config.js";
import type { SecretStore } from "../secrets.js";
import type { LocalDatabase } from "../storage/database.js";
import { groundAnalysis } from "./grounding.js";
import { OpenAIResponsesModelAdapter } from "./openai.js";
import type { ModelAdapter, SpaceAnalysisInput } from "./types.js";

const RETENTION_ACKNOWLEDGEMENT = "openai-default-retention-v1";
const MAX_MESSAGES_PER_SPACE = 400;
const MAX_CONTEXT_CHARACTERS = 120_000;

export interface CurrentUserProvider {
  getCurrentUserId(): Promise<string>;
}

export type ModelAdapterFactory = (apiKey: string) => ModelAdapter;

export class AnalysisService {
  private userId: string | undefined;

  public constructor(
    private readonly configuration: AppConfiguration,
    private readonly secrets: SecretStore,
    private readonly database: LocalDatabase,
    private readonly currentUser: CurrentUserProvider,
    private readonly createAdapter: ModelAdapterFactory = (apiKey) =>
      new OpenAIResponsesModelAdapter(configuration, apiKey),
  ) {}

  public async readiness(): Promise<AnalysisReadiness> {
    const credentialConfigured = await this.secrets.get(this.configuration.model.credentialRef) !== null;
    const retentionAcknowledged = this.database.hasAcknowledgement(RETENTION_ACKNOWLEDGEMENT);
    return {
      modelName: this.configuration.model.name,
      credentialConfigured,
      retentionAcknowledged,
      enabled: credentialConfigured && retentionAcknowledged,
      disclosureUrl: "https://developers.openai.com/api/docs/guides/your-data",
    };
  }

  public acknowledgeRetention(): void {
    this.database.setAcknowledgement(RETENTION_ACKNOWLEDGEMENT);
  }

  public list(): InsightDashboard {
    return this.database.listInsights();
  }

  public updateAction(id: string, input: ActionFeedbackInput) {
    return this.database.updateActionFeedback(id, input);
  }

  public async analyze(roomId: string, signal?: AbortSignal): Promise<"analyzed" | "skipped"> {
    if (!this.database.hasAcknowledgement(RETENTION_ACKNOWLEDGEMENT)) return "skipped";
    const apiKey = await this.secrets.get(this.configuration.model.credentialRef);
    if (apiKey === null) return "skipped";
    const since = new Date(Date.now() - this.configuration.scan.initialBackfillDays * 86_400_000).toISOString();
    const context = this.database.analysisContext(roomId, since);
    if (context === null) return "skipped";
    if (context.messages.length === 0) {
      const now = new Date().toISOString();
      const emptyInput: SpaceAnalysisInput = {
        roomId,
        spaceType: context.spaceType,
        userId: "USER",
        messages: [],
        periodStart: since,
        periodEnd: now,
        coverage: context.coverage,
      };
      const empty = groundAnalysis(emptyInput, context.spaceTitle, {
        summary: {
          overview: "No material activity was available in the retained analysis period.",
          mainTopics: [], decisions: [], openQuestions: [], risks: [], userActions: [], otherActions: [],
          importantLinks: [], noMaterialActivity: true, evidenceMessageIds: [],
        },
        actions: [],
      }, this.configuration.model.name, now);
      this.database.saveInsights(empty.summary, empty.actions);
      return "analyzed";
    }
    this.userId ??= await this.currentUser.getCurrentUserId();
    const bounded = boundMessages(context.messages);
    const input: SpaceAnalysisInput = {
      roomId,
      spaceType: context.spaceType,
      userId: this.userId,
      messages: bounded.messages,
      periodStart: bounded.messages[0]?.created ?? since,
      periodEnd: bounded.messages.at(-1)?.created ?? new Date().toISOString(),
      coverage: context.coverage === "partial" || bounded.truncated ? "partial" : "complete",
    };
    this.database.markInsightsStale(roomId);
    const adapter = this.createAdapter(apiKey);
    const output = await adapter.analyze(input, signal);
    const grounded = groundAnalysis(input, context.spaceTitle, output, this.configuration.model.name);
    this.database.saveInsights(grounded.summary, grounded.actions);
    return "analyzed";
  }
}

function boundMessages(messages: SpaceAnalysisInput["messages"]): {
  readonly messages: SpaceAnalysisInput["messages"];
  readonly truncated: boolean;
} {
  const selected = [] as SpaceAnalysisInput["messages"][number][];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < MAX_MESSAGES_PER_SPACE; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (selected.length > 0 && characters + message.text.length > MAX_CONTEXT_CHARACTERS) break;
    selected.push(message);
    characters += message.text.length;
  }
  selected.reverse();
  return { messages: selected, truncated: selected.length !== messages.length };
}
