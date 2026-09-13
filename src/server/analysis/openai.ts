import type { AppConfiguration } from "../config.js";
import type { ModelAdapter, ModelAnalysisOutput, SpaceAnalysisInput } from "./types.js";
import { ANALYSIS_SYSTEM_PROMPT, SPACE_ANALYSIS_JSON_SCHEMA } from "./schema.js";
import { AnalysisValidationError, parseModelAnalysis } from "./grounding.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIModelError extends Error {
  public constructor(message: string) { super(message); this.name = "OpenAIModelError"; }
}

export class OpenAIResponsesModelAdapter implements ModelAdapter {
  public constructor(
    private readonly configuration: AppConfiguration,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async analyze(input: SpaceAnalysisInput, signal?: AbortSignal): Promise<ModelAnalysisOutput> {
    let validationError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestBody = {
        model: this.configuration.model.name,
        store: false,
        background: false,
        reasoning: { effort: this.configuration.model.reasoningEffort },
        prompt_cache_options: { mode: "explicit" },
        input: [
          { role: "developer", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(aliasInput(input)) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "webex_space_analysis_v1",
            strict: true,
            schema: SPACE_ANALYSIS_JSON_SCHEMA,
          },
        },
      };
      assertMinimizedStorageRequest(requestBody);
      const response = await this.fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(requestBody),
        redirect: "error",
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new OpenAIModelError(`OpenAI Responses request failed with status ${response.status}`);
      const envelope = await response.json() as unknown;
      try {
        return parseModelAnalysis(JSON.parse(extractOutputText(envelope)) as unknown);
      } catch (error: unknown) {
        validationError = error;
      }
    }
    throw validationError instanceof AnalysisValidationError
      ? validationError
      : new OpenAIModelError("OpenAI returned invalid structured output twice");
  }
}

export function assertMinimizedStorageRequest(value: Record<string, unknown>): void {
  if (value.store !== false || value.background !== false) {
    throw new OpenAIModelError("Model request violates the approved storage profile");
  }
  for (const prohibited of ["conversation", "previous_response_id", "tools", "tool_choice"] as const) {
    if (prohibited in value) throw new OpenAIModelError(`Model request contains prohibited field ${prohibited}`);
  }
  const caching = value.prompt_cache_options;
  if (typeof caching !== "object" || caching === null || Array.isArray(caching)) {
    throw new OpenAIModelError("Prompt caching must be explicitly configured");
  }
  const cachingRecord = caching as Record<string, unknown>;
  if (cachingRecord.mode !== "explicit" || Object.keys(cachingRecord).some((key) => key !== "mode")) {
    throw new OpenAIModelError("Prompt caching keys and breakpoints are prohibited");
  }
}

function aliasInput(input: SpaceAnalysisInput): Record<string, unknown> {
  const aliases = new Map<string, string>([[input.userId, "USER"]]);
  let next = 1;
  const alias = (id: string | undefined): string => {
    if (id === undefined) return "UNKNOWN";
    const known = aliases.get(id);
    if (known !== undefined) return known;
    const value = `P${next++}`;
    aliases.set(id, value);
    return value;
  };
  return {
    schemaVersion: 1,
    roomId: input.roomId,
    roomType: input.spaceType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    coverage: input.coverage,
    messages: input.messages.map((message) => ({
      id: message.id,
      parentId: message.parentId ?? null,
      author: alias(message.authorId),
      created: message.created,
      text: message.text,
      mentionedPeople: message.mentionedPeople.map((id) => alias(id)),
      hasAttachments: message.hasAttachments,
    })),
  };
}

function extractOutputText(value: unknown): string {
  if (typeof value !== "object" || value === null) throw new OpenAIModelError("OpenAI response was not an object");
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) throw new OpenAIModelError("OpenAI response did not contain output");
  for (const item of record.output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "output_text") {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string") return text;
      }
    }
  }
  throw new OpenAIModelError("OpenAI response did not contain structured output text");
}
