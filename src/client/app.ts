import type {
  ActionCandidateView,
  ActionCategory,
  ActionFeedbackInput,
  ActionStatus,
  AnalysisReadiness,
  ConfidenceLevel,
  HealthResponse,
  InsightDashboard,
  PublicConfiguration,
  ScanStatus,
  SchedulerStatus,
  WebexAuthorizationStart,
  WebexConnectionStatus,
  WebexSpaceCatalog,
  WatchedCollectionCatalog,
  WatchedCollectionView,
} from "../shared/contracts.js";
import { ACTION_CATEGORIES } from "../shared/contracts.js";

const statusElement = requiredElement("service-status");
const modelElement = requiredElement("model-status");
const scheduleElement = requiredElement("schedule-status");
const retentionElement = requiredElement("retention-status");
const connectButton = requiredButton("webex-connect");
const disconnectButton = requiredButton("webex-disconnect");
const refreshSpacesButton = requiredButton("refresh-spaces");
const activityWindowForm = requiredForm("catalog-activity-form");
const activityWindowSelect = requiredSelect("catalog-activity-window");
const saveActivityWindowButton = requiredButton("save-catalog-activity-window");
const collectionSelect = requiredSelect("collection-select");
const saveCollectionSpacesButton = requiredButton("save-collection-spaces");
const collectionForm = requiredForm("collection-form");
const scanNowButton = requiredButton("scan-now");
const retentionAccept = requiredInput("retention-accept");
const retentionConfirm = requiredButton("retention-confirm");
const refreshInsightsButton = requiredButton("refresh-insights");
let currentSpaces: WebexSpaceCatalog["spaces"] = [];
let currentCollections: WatchedCollectionView[] = [];

connectButton.addEventListener("click", () => void startWebexAuthorization());
disconnectButton.addEventListener("click", () => void disconnectWebex());
refreshSpacesButton.addEventListener("click", () => void loadSpaces());
activityWindowForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveCatalogActivityWindow();
});
collectionSelect.addEventListener("change", renderSpaces);
saveCollectionSpacesButton.addEventListener("click", () => void saveCollectionSpaces());
collectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createCollection();
});
scanNowButton.addEventListener("click", () => void startScan());
retentionAccept.addEventListener("change", () => { retentionConfirm.disabled = !retentionAccept.checked; });
retentionConfirm.addEventListener("click", () => void confirmRetention());
refreshInsightsButton.addEventListener("click", () => void loadInsights());

void loadDashboard();

async function loadDashboard(): Promise<void> {
  try {
    const [health, configuration, webex, scheduler, scan, readiness] = await Promise.all([
      fetchJson<HealthResponse>("/api/health"),
      fetchJson<PublicConfiguration>("/api/configuration"),
      fetchJson<WebexConnectionStatus>("/api/webex/status"),
      fetchJson<SchedulerStatus>("/api/scheduler/status"),
      fetchJson<ScanStatus>("/api/scans/current"),
      fetchJson<AnalysisReadiness>("/api/analysis/readiness"),
    ]);

    statusElement.textContent = `${health.status.toUpperCase()} · v${health.version}`;
    statusElement.dataset.state = "ok";
    modelElement.textContent = `${configuration.modelName} · ${readiness.enabled ? "ready" : "setup required"}`;
    scheduleElement.textContent = scheduler.nextRunAt === undefined
      ? `Every ${configuration.scanIntervalMinutes} minutes · app-open only`
      : `Next ${new Date(scheduler.nextRunAt).toLocaleString()} · app-open only`;
    retentionElement.textContent = `${configuration.rawMessageRetentionDays} days raw · ${configuration.derivedInsightRetentionDays} days insights`;
    setActivityWindowSelect(configuration.catalogActivityWindowDays);

    requiredElement("guardrail-status").textContent = configuration.externalWritesEnabled
      ? "Configuration error"
      : "External writes disabled";
    requiredElement("direct-message-status").textContent = configuration.directMessagesIncluded
      ? "Included"
      : "Excluded";
    renderWebexStatus(webex);
    renderAnalysisReadiness(readiness);
    renderScanStatus(scan);
    await Promise.all([loadCollections(), loadInsights()]);
  } catch {
    statusElement.textContent = "Service unavailable";
    statusElement.dataset.state = "error";
  }
}

function renderAnalysisReadiness(readiness: AnalysisReadiness): void {
  requiredElement("retention-disclosure-link").setAttribute("href", readiness.disclosureUrl);
  retentionAccept.checked = readiness.retentionAcknowledged;
  retentionAccept.disabled = readiness.retentionAcknowledged;
  retentionConfirm.disabled = readiness.retentionAcknowledged || !retentionAccept.checked;
  retentionConfirm.hidden = readiness.retentionAcknowledged;
  requiredElement("analysis-readiness").textContent = readiness.enabled
    ? `${readiness.modelName} is ready. Future selected-space scans will generate local insights.`
    : !readiness.credentialConfigured
      ? "OpenAI API key not found in the configured macOS Keychain entry. Analysis will be skipped safely."
      : "The local retention acknowledgment is required before message content can leave this device.";
}

async function confirmRetention(): Promise<void> {
  retentionConfirm.disabled = true;
  try {
    renderAnalysisReadiness(await postJson<AnalysisReadiness>("/api/analysis/acknowledgement", { accepted: true }));
  } catch {
    requiredElement("analysis-readiness").textContent = "The local acknowledgment could not be saved.";
    retentionConfirm.disabled = false;
  }
}

function renderWebexStatus(status: WebexConnectionStatus): void {
  const identity = requiredElement("webex-identity");
  const scopes = requiredElement("webex-scopes");
  connectButton.disabled = !status.configured;
  connectButton.hidden = status.connected;
  disconnectButton.hidden = !status.connected;
  refreshSpacesButton.disabled = !status.connected || status.tokenHealth === "error";
  scanNowButton.disabled = !status.connected;

  if (!status.configured) {
    identity.textContent = "OAuth setup is required before Webex can be connected.";
    scopes.textContent = "Add the integration client ID to local configuration and its client secret to macOS Keychain.";
    return;
  }
  if (!status.connected) {
    identity.textContent = "Ready to connect with read-only access.";
    scopes.textContent = "Requested scopes: messages read, rooms read, profile read, and Webex KMS access.";
    return;
  }
  identity.textContent = status.identity === undefined
    ? `Connected · token ${status.tokenHealth}`
    : `Connected as ${status.identity.displayName}`;
  scopes.textContent = `Granted scopes: ${status.grantedScopes.join(", ") || "not reported"}`;
}

async function startWebexAuthorization(): Promise<void> {
  setWebexHelp("Preparing the Webex authorization page…");
  try {
    const result = await postJson<WebexAuthorizationStart>("/api/webex/oauth/start");
    window.location.assign(result.authorizationUrl);
  } catch {
    setWebexHelp("Webex authorization could not be started. Check the local OAuth and Keychain setup.");
  }
}

async function disconnectWebex(): Promise<void> {
  disconnectButton.disabled = true;
  try {
    await postJson<void>("/api/webex/disconnect");
    window.location.reload();
  } catch {
    disconnectButton.disabled = false;
    setWebexHelp("The local Webex authorization could not be removed.");
  }
}

async function loadSpaces(): Promise<void> {
  refreshSpacesButton.disabled = true;
  const list = requiredElement("space-list");
  list.replaceChildren(paragraph("Loading spaces…"));
  try {
    const catalog = await fetchJson<WebexSpaceCatalog>("/api/webex/spaces");
    currentSpaces = catalog.spaces;
    requiredElement("catalog-filter-help").textContent = catalog.activityWindowDays === null
      ? `Showing all ${catalog.totalSpaces} accessible spaces. Previously selected spaces remain selected.`
      : `Showing ${catalog.spaces.length} of ${catalog.totalSpaces} accessible spaces with activity in the last ${catalog.activityWindowDays} days, plus any selected older spaces.`;
    if (catalog.spaces.length === 0) {
      list.replaceChildren(paragraph("No spaces match the current activity window."));
    } else {
      renderSpaces();
    }
  } catch {
    list.replaceChildren(paragraph("Spaces could not be loaded. Retry the catalog refresh; reconnect only if the account status shows an error."));
  } finally {
    refreshSpacesButton.disabled = false;
  }
}

async function saveCatalogActivityWindow(): Promise<void> {
  const activityWindowDays = activityWindowSelect.value === "all" ? null : Number(activityWindowSelect.value);
  saveActivityWindowButton.disabled = true;
  try {
    const configuration = await postJson<PublicConfiguration>("/api/configuration/catalog-activity-window", {
      activityWindowDays,
    });
    setActivityWindowSelect(configuration.catalogActivityWindowDays);
    setWebexHelp(configuration.catalogActivityWindowDays === null
      ? "The space catalog now includes all activity."
      : `The space catalog now shows activity from the last ${configuration.catalogActivityWindowDays} days.`);
    if (!refreshSpacesButton.disabled) await loadSpaces();
  } catch {
    setWebexHelp("The catalog activity window could not be saved.");
  } finally {
    saveActivityWindowButton.disabled = false;
  }
}

function setActivityWindowSelect(days: number | null): void {
  const value = days === null ? "all" : String(days);
  if (![...activityWindowSelect.options].some((option) => option.value === value)) {
    activityWindowSelect.append(new Option(`${days} days`, value));
  }
  activityWindowSelect.value = value;
}

async function loadCollections(selectedId?: string): Promise<void> {
  const catalog = await fetchJson<WatchedCollectionCatalog>("/api/collections");
  currentCollections = [...catalog.collections];
  collectionSelect.replaceChildren();
  if (currentCollections.length === 0) {
    collectionSelect.append(new Option("Create a collection to select spaces", ""));
    collectionSelect.disabled = true;
    saveCollectionSpacesButton.disabled = true;
  } else {
    for (const collection of currentCollections) collectionSelect.append(new Option(collection.name, collection.id));
    collectionSelect.disabled = false;
    collectionSelect.value = selectedId ?? currentCollections[0]?.id ?? "";
    saveCollectionSpacesButton.disabled = currentSpaces.length === 0;
  }
  renderSpaces();
}

async function createCollection(): Promise<void> {
  const nameInput = requiredInput("collection-name");
  const name = nameInput.value.trim();
  if (name === "") return;
  try {
    const created = await postJson<WatchedCollectionView>("/api/collections", { name });
    nameInput.value = "";
    await loadCollections(created.id);
    setWebexHelp(`Created Watched Collection “${created.name}”.`);
  } catch {
    setWebexHelp("The Watched Collection could not be created.");
  }
}

async function saveCollectionSpaces(): Promise<void> {
  const collectionId = collectionSelect.value;
  if (collectionId === "") return;
  const spaceIds = [...document.querySelectorAll<HTMLInputElement>("input[data-space-id]:checked")]
    .map((input) => input.dataset.spaceId)
    .filter((value): value is string => value !== undefined);
  saveCollectionSpacesButton.disabled = true;
  try {
    await postJson<WatchedCollectionView>(`/api/collections/${collectionId}/spaces`, { spaceIds });
    await loadCollections(collectionId);
    setWebexHelp(`Saved ${spaceIds.length} selected space${spaceIds.length === 1 ? "" : "s"}.`);
  } catch {
    setWebexHelp("The selected spaces could not be saved.");
  } finally {
    saveCollectionSpacesButton.disabled = false;
  }
}

async function startScan(): Promise<void> {
  scanNowButton.disabled = true;
  try {
    const status = await postJson<ScanStatus>("/api/scans");
    renderScanStatus(status);
    await pollScan();
  } catch {
    requiredElement("scan-status").textContent = "The scan could not be started.";
  } finally {
    scanNowButton.disabled = false;
  }
}

async function pollScan(): Promise<void> {
  for (let attempt = 0; attempt < 3_600; attempt += 1) {
    const status = await fetchJson<ScanStatus>("/api/scans/current");
    renderScanStatus(status);
    if (status.state !== "running") {
      await loadInsights();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
}

async function loadInsights(): Promise<void> {
  try {
    const dashboard = await fetchJson<InsightDashboard>("/api/insights");
    renderActions(dashboard.actions);
    renderSummaries(dashboard.summaries);
  } catch {
    requiredElement("action-list").replaceChildren(paragraph("Insights could not be loaded from the local store."));
  }
}

function renderActions(actions: readonly ActionCandidateView[]): void {
  const list = requiredElement("action-list");
  if (actions.length === 0) {
    list.replaceChildren(paragraph("No active action candidates yet. Run a model-enabled scan after selecting spaces."));
    return;
  }
  list.replaceChildren(...actions.map(actionCard));
}

function actionCard(action: ActionCandidateView): HTMLElement {
  const article = document.createElement("article");
  article.className = "action-card";
  const header = document.createElement("header");
  const heading = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = action.recommendedNextStep || action.category;
  const location = paragraph(`${action.spaceTitle} · ${new Date(action.sourceTimestamp).toLocaleString()}`);
  heading.append(title, location);
  const chips = document.createElement("div");
  chips.className = "chips";
  chips.append(chip(action.category), chip(`${action.confidence} confidence`), chip(action.status));
  if (action.stale) chips.append(chip("Needs re-review"));
  for (const collection of action.collectionNames) chips.append(chip(collection));
  header.append(heading, chips);
  const rationale = paragraph(action.rationale);
  const source = document.createElement("div");
  source.className = "source-block";
  const sourceLink = document.createElement("a");
  sourceLink.href = action.sourceUrl;
  sourceLink.textContent = "Open source space";
  const quote = document.createElement("blockquote");
  quote.textContent = action.sourceSnippet;
  const reference = document.createElement("small");
  const sourceReference = `${action.spaceTitle} · ${action.sourceAuthor} · ${new Date(action.sourceTimestamp).toLocaleString()} · source ${action.sourceMessageId}`;
  reference.textContent = sourceReference;
  const copyReference = document.createElement("button");
  copyReference.type = "button";
  copyReference.className = "copy-reference";
  copyReference.textContent = "Copy source reference";
  copyReference.addEventListener("click", () => {
    void navigator.clipboard.writeText(sourceReference)
      .then(() => { copyReference.textContent = "Copied"; })
      .catch(() => { copyReference.textContent = "Copy failed"; });
  });
  const warning = paragraph(action.compatibilityWarning);
  warning.className = "compatibility-warning";
  const context = document.createElement("details");
  const contextLabel = document.createElement("summary");
  contextLabel.textContent = "Show nearby context";
  const contextText = document.createElement("pre");
  contextText.textContent = action.contextPreview;
  context.append(contextLabel, contextText);
  source.append(sourceLink, quote, reference, copyReference, warning, context);
  article.append(header, rationale, source, feedbackForm(action));
  return article;
}

function feedbackForm(action: ActionCandidateView): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "feedback-form";
  const status = selectField("Status", ["New", "Reviewed", "In progress", "Snoozed", "Resolved", "Dismissed", "Not mine"], action.status);
  const category = selectField("Category", ACTION_CATEGORIES, action.category);
  const owner = inputField("Owner", "text", action.owner);
  const due = inputField("Due date", "date", action.dueDate?.slice(0, 10) ?? "");
  const confidence = selectField("Confidence", ["High", "Medium", "Low"], action.confidence);
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save review";
  form.append(status.label, category.label, owner.label, due.label, confidence.label, save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    const input: ActionFeedbackInput = {
      status: status.select.value as ActionStatus,
      category: category.select.value as ActionCategory,
      owner: owner.input.value,
      dueDate: due.input.value === "" ? null : due.input.value,
      confidence: confidence.select.value as ConfidenceLevel,
    };
    void postJson<ActionCandidateView>(`/api/actions/${action.id}`, input)
      .then(loadInsights)
      .catch(() => { save.textContent = "Retry save"; save.disabled = false; });
  });
  return form;
}

function renderSummaries(summaries: InsightDashboard["summaries"]): void {
  const list = requiredElement("summary-list");
  if (summaries.length === 0) {
    list.replaceChildren(paragraph("No summaries yet. Analysis runs after Webex ingestion when model setup is complete."));
    return;
  }
  list.replaceChildren(...summaries.map((summary) => {
    const article = document.createElement("article");
    article.className = "summary-card";
    const title = document.createElement("h3");
    title.textContent = summary.spaceTitle;
    const period = paragraph(`${new Date(summary.periodStart).toLocaleString()} – ${new Date(summary.periodEnd).toLocaleString()} · ${summary.coverage} coverage${summary.stale ? " · Needs re-review" : ""}`);
    const overview = paragraph(summary.noMaterialActivity ? "No material activity in this period." : summary.overview);
    article.append(title, period, overview);
    const groups: Array<[string, readonly string[]]> = [
      ["Main topics", summary.mainTopics], ["Decisions", summary.decisions],
      ["Open questions", summary.openQuestions], ["Risks", summary.risks],
      ["Your actions", summary.userActions], ["Other actions", summary.otherActions],
      ["Important links", summary.importantLinks],
    ];
    for (const [label, items] of groups) if (items.length > 0) article.append(detailList(label, items));
    return article;
  }));
}

function detailList(label: string, items: readonly string[]): HTMLDetailsElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `${label} (${items.length})`;
  const list = document.createElement("ul");
  for (const item of items) { const entry = document.createElement("li"); entry.textContent = item; list.append(entry); }
  details.append(summary, list);
  return details;
}

function chip(text: string): HTMLSpanElement {
  const element = document.createElement("span"); element.className = "chip"; element.textContent = text; return element;
}

function selectField(labelText: string, values: readonly string[], selected: string): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = document.createElement("label"); label.append(document.createTextNode(labelText));
  const select = document.createElement("select");
  for (const value of values) select.append(new Option(value, value, false, value === selected));
  label.append(select); return { label, select };
}

function inputField(labelText: string, type: string, value: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label"); label.append(document.createTextNode(labelText));
  const input = document.createElement("input"); input.type = type; input.value = value; input.maxLength = 200;
  label.append(input); return { label, input };
}

function renderScanStatus(status: ScanStatus): void {
  const element = requiredElement("scan-status");
  if (status.state === "running") {
    element.textContent = `Scanning ${status.spacesCompleted + status.spacesFailed} of ${status.spacesTotal} spaces · ${status.messagesIngested} messages retained.`;
    return;
  }
  if (status.state === "complete" || status.state === "partial") {
    element.textContent = `${status.state === "complete" ? "Scan complete" : "Scan partially complete"}: ${status.spacesCompleted} spaces, ${status.messagesIngested} messages.${status.warning === undefined ? "" : ` ${status.warning}`}`;
    return;
  }
  element.textContent = status.warning ?? "No scan has run in this app session.";
}

function renderSpaces(): void {
  const list = requiredElement("space-list");
  if (currentSpaces.length === 0) return;
  const selected = new Set(currentCollections.find((collection) => collection.id === collectionSelect.value)?.spaceIds ?? []);
  list.replaceChildren(...currentSpaces.map((space) => spaceCard(space, selected.has(space.id))));
  saveCollectionSpacesButton.disabled = collectionSelect.value === "";
}

function spaceCard(space: WebexSpaceCatalog["spaces"][number], checked: boolean): HTMLElement {
  const article = document.createElement("article");
  article.className = "space-item";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.dataset.spaceId = space.id;
  checkbox.setAttribute("aria-label", `Select ${space.title}`);
  checkbox.disabled = collectionSelect.value === "";
  const content = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = space.title;
  const details = document.createElement("p");
  const activity = space.lastActivity === undefined
    ? "Activity unknown"
    : `active ${new Date(space.lastActivity).toLocaleString()}`;
  const windowStatus = space.activityWindowStatus === "outside-window"
    ? " · Outside activity window"
    : "";
  details.textContent = `${space.type === "direct" ? "Direct message" : "Group space"} · ${activity}${windowStatus}`;
  content.append(title, details);
  article.append(checkbox, content);
  return article;
}

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

function setWebexHelp(text: string): void {
  requiredElement("webex-help").textContent = text;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "X-Action-Insights-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected button element: ${id}`);
  }
  return element;
}

function requiredSelect(id: string): HTMLSelectElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Expected select element: ${id}`);
  return element;
}

function requiredForm(id: string): HTMLFormElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLFormElement)) throw new Error(`Expected form element: ${id}`);
  return element;
}

function requiredInput(id: string): HTMLInputElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Expected input element: ${id}`);
  return element;
}
