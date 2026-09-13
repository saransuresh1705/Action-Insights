import type {
  HealthResponse,
  PublicConfiguration,
  ScanStatus,
  SchedulerStatus,
  WebexAuthorizationStart,
  WebexConnectionStatus,
  WebexSpaceCatalog,
  WatchedCollectionCatalog,
  WatchedCollectionView,
} from "../shared/contracts.js";

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

void loadDashboard();

async function loadDashboard(): Promise<void> {
  try {
    const [health, configuration, webex, scheduler, scan] = await Promise.all([
      fetchJson<HealthResponse>("/api/health"),
      fetchJson<PublicConfiguration>("/api/configuration"),
      fetchJson<WebexConnectionStatus>("/api/webex/status"),
      fetchJson<SchedulerStatus>("/api/scheduler/status"),
      fetchJson<ScanStatus>("/api/scans/current"),
    ]);

    statusElement.textContent = `${health.status.toUpperCase()} · v${health.version}`;
    statusElement.dataset.state = "ok";
    modelElement.textContent = `${configuration.modelName} · ${configuration.modelEnabled ? "configured" : "setup required"}`;
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
    renderScanStatus(scan);
    await loadCollections();
  } catch {
    statusElement.textContent = "Service unavailable";
    statusElement.dataset.state = "error";
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
    if (status.state !== "running") return;
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
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
