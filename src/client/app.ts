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

const ACTION_CATEGORIES: readonly ActionCategory[] = [
  "Reply required", "Acknowledgement", "Decision / approval", "Review / feedback",
  "External work item", "Research / information", "Meeting / scheduling", "Follow-up / reminder",
  "Blocker / dependency", "Risk / escalation", "Delegation candidate", "FYI / no action", "Ambiguous",
];

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
const viewToggleButton = requiredButton("view-toggle");
const insightsView = requiredElement("insights-view");
const settingsView = requiredElement("settings-view");
const openWarningSettingsButton = requiredButton("open-warning-settings");
const directSpaceTab = requiredButton("space-tab-direct");
const groupSpaceTab = requiredButton("space-tab-group");
const spaceSearchInput = requiredInput("space-search");
const selectVisibleSpacesButton = requiredButton("select-visible-spaces");
const clearVisibleSpacesButton = requiredButton("clear-visible-spaces");
const insightSearchInput = requiredInput("insight-search");
const filterCollection = requiredSelect("filter-collection");
const filterSpace = requiredSelect("filter-space");
const filterCategory = requiredSelect("filter-category");
const filterConfidence = requiredSelect("filter-confidence");
const filterStatus = requiredSelect("filter-status");
const filterDue = requiredInput("filter-due");
const filterAuthor = requiredInput("filter-author");
const filterPeriod = requiredSelect("filter-period");
const clearInsightFiltersButton = requiredButton("clear-insight-filters");
let currentSpaces: WebexSpaceCatalog["spaces"] = [];
let currentCollections: WatchedCollectionView[] = [];
let currentInsights: InsightDashboard = { summaries: [], actions: [] };
let currentView: "insights" | "settings" = "insights";
let activeSpaceType: "direct" | "group" = "direct";
let activeCollectionId = "";
let savedSelection = new Set<string>();
let draftSelection = new Set<string>();
const spaceSearchByType = new Map<"direct" | "group", string>([["direct", ""], ["group", ""]]);
let webexReady = false;
let modelReady = false;

connectButton.addEventListener("click", () => void startWebexAuthorization());
disconnectButton.addEventListener("click", () => void disconnectWebex());
refreshSpacesButton.addEventListener("click", () => void loadSpaces());
activityWindowForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveCatalogActivityWindow();
});
collectionSelect.addEventListener("change", () => changeCollection());
saveCollectionSpacesButton.addEventListener("click", () => void saveCollectionSpaces());
collectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createCollection();
});
scanNowButton.addEventListener("click", () => void startScan());
retentionAccept.addEventListener("change", () => { retentionConfirm.disabled = !retentionAccept.checked; });
retentionConfirm.addEventListener("click", () => void confirmRetention());
refreshInsightsButton.addEventListener("click", () => void loadInsights());
viewToggleButton.addEventListener("click", () => showView(currentView === "insights" ? "settings" : "insights"));
openWarningSettingsButton.addEventListener("click", () => showView("settings", true));
directSpaceTab.addEventListener("click", () => showSpaceType("direct"));
groupSpaceTab.addEventListener("click", () => showSpaceType("group"));
for (const tab of [directSpaceTab, groupSpaceTab]) {
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    showSpaceType(activeSpaceType === "direct" ? "group" : "direct", true);
  });
}
spaceSearchInput.addEventListener("input", () => {
  spaceSearchByType.set(activeSpaceType, spaceSearchInput.value);
  renderSpaces();
});
selectVisibleSpacesButton.addEventListener("click", () => bulkSelectVisible(true));
clearVisibleSpacesButton.addEventListener("click", () => bulkSelectVisible(false));
for (const input of [insightSearchInput, filterCollection, filterSpace, filterCategory, filterConfidence, filterStatus, filterDue, filterAuthor, filterPeriod]) {
  input.addEventListener("input", renderInsights);
  input.addEventListener("change", renderInsights);
}
clearInsightFiltersButton.addEventListener("click", clearInsightFilters);
window.addEventListener("beforeunload", (event) => {
  if (!isSelectionDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});
for (const group of document.querySelectorAll<HTMLDetailsElement>(".settings-group")) {
  group.addEventListener("toggle", () => {
    if (!group.open) return;
    for (const other of document.querySelectorAll<HTMLDetailsElement>(".settings-group")) {
      if (other !== group) other.open = false;
    }
  });
}

for (const category of ACTION_CATEGORIES) filterCategory.append(new Option(category, category));

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
    requiredElement("next-scan-status").textContent = scheduler.nextRunAt === undefined
      ? `Every ${configuration.scanIntervalMinutes} minutes while the app is open`
      : `Next scheduled scan: ${new Date(scheduler.nextRunAt).toLocaleString()}`;
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
  modelReady = readiness.enabled;
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
  updateBlockingWarning();
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
  webexReady = status.connected && status.tokenHealth !== "error";
  connectButton.disabled = !status.configured;
  connectButton.hidden = status.connected;
  disconnectButton.hidden = !status.connected;
  refreshSpacesButton.disabled = !status.connected || status.tokenHealth === "error";
  scanNowButton.disabled = !status.connected;

  if (!status.configured) {
    identity.textContent = "OAuth setup is required before Webex can be connected.";
    scopes.textContent = "Add the integration client ID to local configuration and its client secret to macOS Keychain.";
    updateBlockingWarning();
    return;
  }
  if (!status.connected) {
    identity.textContent = "Ready to connect with read-only access.";
    scopes.textContent = "Requested scopes: messages read, rooms read, profile read, and Webex KMS access.";
    updateBlockingWarning();
    return;
  }
  identity.textContent = status.identity === undefined
    ? `Connected · token ${status.tokenHealth}`
    : `Connected as ${status.identity.displayName}`;
  scopes.textContent = `Granted scopes: ${status.grantedScopes.join(", ") || "not reported"}`;
  updateBlockingWarning();
}

function showView(target: "insights" | "settings", openAccounts = false): void {
  if (target === currentView) return;
  if (target === "insights" && isSelectionDirty() && !window.confirm("Discard unsaved space-selection changes?")) return;
  if (target === "insights" && isSelectionDirty()) restoreSavedSelection();
  currentView = target;
  const settingsOpen = target === "settings";
  insightsView.hidden = settingsOpen;
  settingsView.hidden = !settingsOpen;
  viewToggleButton.textContent = settingsOpen ? "Back to Insights" : "Settings";
  viewToggleButton.setAttribute("aria-expanded", String(settingsOpen));
  viewToggleButton.setAttribute("aria-controls", settingsOpen ? "insights-view" : "settings-view");
  if (settingsOpen && openAccounts) {
    const firstGroup = document.querySelector<HTMLDetailsElement>(".settings-group");
    if (firstGroup !== null) firstGroup.open = true;
  }
  const heading = requiredElement(settingsOpen ? "settings-title" : "insights-title");
  window.requestAnimationFrame(() => heading.focus());
}

function updateBlockingWarning(): void {
  const warning = requiredElement("insights-warning");
  const text = requiredElement("insights-warning-text");
  if (!webexReady) {
    warning.hidden = false;
    text.textContent = "Webex is not ready. Scans cannot retrieve selected spaces.";
    return;
  }
  if (!modelReady) {
    warning.hidden = false;
    text.textContent = "Conversation analysis is not ready. Webex ingestion can run, but summaries and actions will not be generated.";
    return;
  }
  warning.hidden = true;
  text.textContent = "";
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
    renderSpaces();
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
    activeCollectionId = "";
    savedSelection = new Set();
    draftSelection = new Set();
  } else {
    for (const collection of currentCollections) collectionSelect.append(new Option(collection.name, collection.id));
    collectionSelect.disabled = false;
    const preferred = selectedId ?? activeCollectionId;
    activeCollectionId = currentCollections.some((collection) => collection.id === preferred)
      ? preferred
      : currentCollections[0]?.id ?? "";
    collectionSelect.value = activeCollectionId;
    syncCollectionSelection();
  }
  renderSpaces();
}

function changeCollection(): void {
  const nextId = collectionSelect.value;
  if (isSelectionDirty() && !window.confirm("Discard unsaved space-selection changes?")) {
    collectionSelect.value = activeCollectionId;
    return;
  }
  activeCollectionId = nextId;
  syncCollectionSelection();
  renderSpaces();
}

function syncCollectionSelection(): void {
  savedSelection = new Set(currentCollections.find((collection) => collection.id === activeCollectionId)?.spaceIds ?? []);
  draftSelection = new Set(savedSelection);
}

function restoreSavedSelection(): void {
  draftSelection = new Set(savedSelection);
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
  const spaceIds = [...draftSelection];
  saveCollectionSpacesButton.disabled = true;
  try {
    await postJson<WatchedCollectionView>(`/api/collections/${collectionId}/spaces`, { spaceIds });
    await loadCollections(collectionId);
    setWebexHelp(`Saved ${spaceIds.length} selected space${spaceIds.length === 1 ? "" : "s"}.`);
  } catch {
    setWebexHelp("The selected spaces could not be saved.");
  } finally {
    updateSelectionUi();
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
    currentInsights = await fetchJson<InsightDashboard>("/api/insights");
    populateInsightFilterOptions();
    renderInsights();
  } catch {
    requiredElement("action-list").replaceChildren(paragraph("Insights could not be loaded from the local store."));
    requiredElement("summary-list").replaceChildren(paragraph("Summaries could not be loaded from the local store."));
  }
}

function renderInsights(): void {
  const search = insightSearchInput.value.trim().toLocaleLowerCase();
  const periodCutoff = filterPeriod.value === ""
    ? null
    : Date.now() - Number(filterPeriod.value) * 86_400_000;
  const actions = currentInsights.actions.filter((action) => {
    const searchable = [action.recommendedNextStep, action.spaceTitle, action.rationale, action.sourceSnippet, action.category]
      .join(" ").toLocaleLowerCase();
    return (search === "" || searchable.includes(search))
      && (filterCollection.value === "" || action.collectionNames.includes(filterCollection.value))
      && (filterSpace.value === "" || action.roomId === filterSpace.value)
      && (filterCategory.value === "" || action.category === filterCategory.value)
      && (filterConfidence.value === "" || action.confidence === filterConfidence.value)
      && (filterStatus.value === "" || action.status === filterStatus.value)
      && (filterDue.value === "" || (action.dueDate !== undefined && action.dueDate.slice(0, 10) <= filterDue.value))
      && (filterAuthor.value.trim() === "" || action.sourceAuthor.toLocaleLowerCase().includes(filterAuthor.value.trim().toLocaleLowerCase()))
      && (periodCutoff === null || Date.parse(action.analyzedAt) >= periodCutoff);
  });
  const summaries = currentInsights.summaries.filter((summary) => {
    const searchable = [summary.spaceTitle, summary.overview, ...summary.mainTopics, ...summary.decisions, ...summary.openQuestions]
      .join(" ").toLocaleLowerCase();
    return (search === "" || searchable.includes(search))
      && (filterSpace.value === "" || summary.roomId === filterSpace.value)
      && (periodCutoff === null || Date.parse(summary.analyzedAt) >= periodCutoff);
  });
  renderActions(actions, currentInsights.actions.length > 0);
  renderSummaries(summaries, currentInsights.summaries.length > 0);
  renderActiveFilterLabels();
  renderAttentionCounts();
}

function populateInsightFilterOptions(): void {
  replaceFilterOptions(filterCollection, unique(currentInsights.actions.flatMap((action) => action.collectionNames)), (value) => value);
  const spaces = new Map<string, string>();
  for (const action of currentInsights.actions) spaces.set(action.roomId, action.spaceTitle);
  for (const summary of currentInsights.summaries) spaces.set(summary.roomId, summary.spaceTitle);
  replaceFilterOptions(filterSpace, [...spaces.entries()].sort((left, right) => left[1].localeCompare(right[1])), (entry) => entry[1], (entry) => entry[0]);
}

function replaceFilterOptions<T>(
  select: HTMLSelectElement,
  values: readonly T[],
  label: (value: T) => string,
  key: (value: T) => string = label,
): void {
  const previous = select.value;
  select.replaceChildren(new Option("All", ""));
  for (const value of values) select.append(new Option(label(value), key(value)));
  select.value = [...select.options].some((option) => option.value === previous) ? previous : "";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function renderActions(actions: readonly ActionCandidateView[], hadAny = false): void {
  const list = requiredElement("action-list");
  if (actions.length === 0) {
    list.replaceChildren(paragraph(hadAny
      ? "No actions match the current filters."
      : "No active action candidates yet. Run a model-enabled scan after selecting spaces."));
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
  if (action.dueDate !== undefined) chips.append(chip(`Due ${action.dueDate.slice(0, 10)}${action.dueDateInferred ? " · inferred" : ""}`));
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
  const review = document.createElement("details");
  review.className = "action-review";
  const reviewLabel = document.createElement("summary");
  reviewLabel.textContent = "Review evidence and update";
  const reviewBody = document.createElement("div");
  reviewBody.append(rationale, source, feedbackForm(action));
  review.append(reviewLabel, reviewBody);
  article.append(header, review);
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

function renderSummaries(summaries: InsightDashboard["summaries"], hadAny = false): void {
  const list = requiredElement("summary-list");
  if (summaries.length === 0) {
    list.replaceChildren(paragraph(hadAny
      ? "No summaries match the current search, space, or period."
      : "No summaries yet. Analysis runs after Webex ingestion when model setup is complete."));
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

function clearInsightFilters(): void {
  insightSearchInput.value = "";
  for (const select of [filterCollection, filterSpace, filterCategory, filterConfidence, filterStatus, filterPeriod]) select.value = "";
  filterDue.value = "";
  filterAuthor.value = "";
  renderInsights();
}

function renderActiveFilterLabels(): void {
  const container = requiredElement("active-filter-labels");
  const active: Array<{ label: string; clear: () => void }> = [];
  if (insightSearchInput.value.trim() !== "") active.push({ label: "Search active", clear: () => { insightSearchInput.value = ""; } });
  for (const [label, select] of [["Collection", filterCollection], ["Space", filterSpace], ["Category", filterCategory], ["Confidence", filterConfidence], ["Status", filterStatus], ["Period", filterPeriod]] as const) {
    if (select.value !== "") active.push({ label: `${label}: ${select.selectedOptions[0]?.textContent ?? select.value}`, clear: () => { select.value = ""; } });
  }
  if (filterDue.value !== "") active.push({ label: `Due by ${filterDue.value}`, clear: () => { filterDue.value = ""; } });
  if (filterAuthor.value.trim() !== "") active.push({ label: "Author filter active", clear: () => { filterAuthor.value = ""; } });
  container.replaceChildren(...active.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${item.label} ×`;
    button.setAttribute("aria-label", `Remove ${item.label} filter`);
    button.addEventListener("click", () => { item.clear(); renderInsights(); });
    return button;
  }));
  clearInsightFiltersButton.disabled = active.length === 0;
}

function renderAttentionCounts(): void {
  const today = new Date().toISOString().slice(0, 10);
  const newCount = currentInsights.actions.filter((action) => action.status === "New").length;
  const overdueCount = currentInsights.actions.filter((action) => action.dueDate !== undefined && action.dueDate.slice(0, 10) < today).length;
  const reviewCount = currentInsights.actions.filter((action) => action.stale || action.confidence === "Low" || action.category === "Ambiguous").length;
  requiredElement("new-action-count").textContent = String(newCount);
  requiredElement("overdue-action-count").textContent = String(overdueCount);
  requiredElement("review-action-count").textContent = String(reviewCount);
  requiredElement("attention-strip").hidden = newCount + overdueCount + reviewCount === 0;
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
  updateSpaceTabCounts();
  const spaces = visibleSpaces();
  if (currentSpaces.length === 0) {
    list.replaceChildren(paragraph(webexReady ? "Refresh the catalog to load spaces." : "Connect Webex to load your spaces."));
  } else if (spaces.length === 0) {
    list.replaceChildren(paragraph(`No ${activeSpaceType === "direct" ? "direct messages" : "group spaces"} match this search.`));
  } else {
    list.replaceChildren(...spaces.map((space) => spaceCard(space, draftSelection.has(space.id))));
  }
  updateSelectionUi();
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
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) draftSelection.add(space.id);
    else draftSelection.delete(space.id);
    updateSelectionUi();
  });
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

function showSpaceType(type: "direct" | "group", focus = false): void {
  activeSpaceType = type;
  const direct = type === "direct";
  directSpaceTab.setAttribute("aria-selected", String(direct));
  directSpaceTab.tabIndex = direct ? 0 : -1;
  groupSpaceTab.setAttribute("aria-selected", String(!direct));
  groupSpaceTab.tabIndex = direct ? -1 : 0;
  requiredElement("space-type-panel").setAttribute("aria-labelledby", direct ? "space-tab-direct" : "space-tab-group");
  spaceSearchInput.value = spaceSearchByType.get(type) ?? "";
  renderSpaces();
  if (focus) (direct ? directSpaceTab : groupSpaceTab).focus();
}

function visibleSpaces(): WebexSpaceCatalog["spaces"] {
  const query = (spaceSearchByType.get(activeSpaceType) ?? "").trim().toLocaleLowerCase();
  return currentSpaces.filter((space) =>
    space.type === activeSpaceType && (query === "" || space.title.toLocaleLowerCase().includes(query)));
}

function bulkSelectVisible(selected: boolean): void {
  if (activeCollectionId === "") return;
  for (const space of visibleSpaces()) {
    if (selected) draftSelection.add(space.id);
    else draftSelection.delete(space.id);
  }
  renderSpaces();
}

function updateSpaceTabCounts(): void {
  for (const type of ["direct", "group"] as const) {
    const visible = currentSpaces.filter((space) => space.type === type);
    const selected = visible.filter((space) => draftSelection.has(space.id)).length;
    requiredElement(type === "direct" ? "direct-tab-count" : "group-tab-count").textContent = `${visible.length} visible · ${selected} selected`;
  }
}

function updateSelectionUi(): void {
  const visibleCount = visibleSpaces().length;
  const hasCollection = activeCollectionId !== "";
  selectVisibleSpacesButton.disabled = !hasCollection || visibleCount === 0;
  clearVisibleSpacesButton.disabled = !hasCollection || visibleCount === 0;
  saveCollectionSpacesButton.disabled = !hasCollection || !isSelectionDirty();
  requiredElement("selection-status").textContent = !hasCollection
    ? "Create a Watched Collection before selecting spaces."
    : isSelectionDirty()
      ? `${draftSelection.size} selected · Unsaved changes`
      : `${draftSelection.size} selected · Saved`;
  updateSpaceTabCounts();
}

function isSelectionDirty(): boolean {
  if (savedSelection.size !== draftSelection.size) return true;
  for (const id of savedSelection) if (!draftSelection.has(id)) return true;
  return false;
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
