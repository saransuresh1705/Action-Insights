import type { HealthResponse, PublicConfiguration } from "../shared/contracts.js";

const statusElement = requiredElement("service-status");
const modelElement = requiredElement("model-status");
const scheduleElement = requiredElement("schedule-status");
const retentionElement = requiredElement("retention-status");

void loadDashboard();

async function loadDashboard(): Promise<void> {
  try {
    const [health, configuration] = await Promise.all([
      fetchJson<HealthResponse>("/api/health"),
      fetchJson<PublicConfiguration>("/api/configuration"),
    ]);

    statusElement.textContent = `${health.status.toUpperCase()} · v${health.version}`;
    statusElement.dataset.state = "ok";
    modelElement.textContent = `${configuration.modelName} · ${configuration.modelEnabled ? "configured" : "setup required"}`;
    scheduleElement.textContent = `Every ${configuration.scanIntervalMinutes} minutes · app-open only`;
    retentionElement.textContent = `${configuration.rawMessageRetentionDays} days raw · ${configuration.derivedInsightRetentionDays} days insights`;

    requiredElement("guardrail-status").textContent = configuration.externalWritesEnabled
      ? "Configuration error"
      : "External writes disabled";
    requiredElement("direct-message-status").textContent = configuration.directMessagesIncluded
      ? "Included"
      : "Excluded";
  } catch {
    statusElement.textContent = "Service unavailable";
    statusElement.dataset.state = "error";
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}
