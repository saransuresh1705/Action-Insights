import type { AppConfiguration } from "../config.js";
import type { JiraIssueRecord } from "./types.js";

export class JiraConnectorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "JiraConnectorError";
  }
}

export class JiraReadOnlyClient {
  public constructor(
    private readonly configuration: AppConfiguration["connectors"]["jira"],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async getIssue(key: string, token: string, signal?: AbortSignal): Promise<JiraIssueRecord> {
    const normalized = key.toUpperCase();
    const project = normalized.split("-")[0] ?? "";
    if (!this.configuration.allowedProjects.includes(project)) {
      throw new JiraConnectorError("Jira project is outside the configured allow-list");
    }
    const apiUrl = appendPath(this.configuration.baseUrl, `rest/api/2/issue/${encodeURIComponent(normalized)}`);
    apiUrl.searchParams.set("fields", "summary,status,updated");
    const response = await this.fetchImpl(apiUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new JiraConnectorError(`Jira read failed with status ${response.status}`);
    const body = await response.json() as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new JiraConnectorError("Jira returned an invalid issue");
    const record = body as Record<string, unknown>;
    const fields = typeof record.fields === "object" && record.fields !== null && !Array.isArray(record.fields)
      ? record.fields as Record<string, unknown>
      : {};
    const statusRecord = typeof fields.status === "object" && fields.status !== null && !Array.isArray(fields.status)
      ? fields.status as Record<string, unknown>
      : {};
    return {
      key: typeof record.key === "string" ? record.key : normalized,
      title: typeof fields.summary === "string" ? fields.summary : "Untitled Jira issue",
      status: typeof statusRecord.name === "string" ? statusRecord.name : "Unknown status",
      ...(typeof fields.updated === "string" ? { updatedAt: fields.updated } : {}),
      url: appendPath(this.configuration.baseUrl, `browse/${encodeURIComponent(normalized)}`).toString(),
    };
  }
}

function appendPath(base: string, path: string): URL {
  return new URL(`${base.replace(/\/$/u, "")}/${path}`);
}
