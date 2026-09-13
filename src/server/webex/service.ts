import type {
  WebexConnectionStatus,
  WebexSpaceSummary,
  WebexSpaceCatalog,
} from "../../shared/contracts.js";
import type { ConfigurationStore } from "../config.js";
import type { WebexReadOnlyClient } from "./client.js";
import type { WebexOAuthService } from "./oauth.js";
import type { LocalDatabase } from "../storage/database.js";

export class WebexService {
  public constructor(
    private readonly oauth: WebexOAuthService,
    private readonly client: WebexReadOnlyClient,
    private readonly database?: LocalDatabase,
    private readonly configurationStore?: Pick<ConfigurationStore, "current">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async beginAuthorization(): Promise<string> {
    return await this.oauth.beginAuthorization();
  }

  public async completeAuthorization(code: string, state: string): Promise<void> {
    await this.oauth.completeAuthorization(code, state);
  }

  public async status(): Promise<WebexConnectionStatus> {
    const status = await this.oauth.status();
    if (!status.connected) return status;
    try {
      const accessToken = await this.oauth.getValidAccessToken();
      const identity = await this.client.getCurrentUser(accessToken);
      return { ...(await this.oauth.status()), tokenHealth: "healthy", identity };
    } catch {
      return { ...status, tokenHealth: "error" };
    }
  }

  public async listSpaces(): Promise<WebexSpaceCatalog> {
    const accessToken = await this.oauth.getValidAccessToken();
    const discoveredSpaces = await this.client.listSpaces(accessToken);
    const selectedIds = new Set(this.database?.selectedSpaceIds() ?? []);
    const activityWindowDays = this.configurationStore?.current().webex.catalogActivityWindowDays ?? 30;
    const retrievedAt = this.now();
    const spaces = filterSpaceCatalog(discoveredSpaces, selectedIds, activityWindowDays, retrievedAt);
    const retrievedAtText = retrievedAt.toISOString();
    this.database?.upsertSpaces(spaces, retrievedAtText);
    return {
      spaces,
      retrievedAt: retrievedAtText,
      activityWindowDays,
      totalSpaces: discoveredSpaces.length,
      excludedSpaces: discoveredSpaces.length - spaces.length,
    };
  }

  public async disconnect(): Promise<void> {
    await this.oauth.disconnect();
  }
}

export function filterSpaceCatalog(
  spaces: readonly WebexSpaceSummary[],
  selectedIds: ReadonlySet<string>,
  activityWindowDays: number | null,
  now: Date,
): readonly WebexSpaceSummary[] {
  const cutoff = activityWindowDays === null ? null : now.getTime() - activityWindowDays * 86_400_000;
  const filtered: WebexSpaceSummary[] = [];

  for (const space of spaces) {
    const selected = selectedIds.has(space.id);
    const lastActivityTime = space.lastActivity === undefined ? Number.NaN : Date.parse(space.lastActivity);
    const activityKnown = Number.isFinite(lastActivityTime);
    const withinWindow = cutoff === null || (activityKnown && lastActivityTime >= cutoff);
    if (!selected && !withinWindow) continue;

    const activityWindowStatus = !activityKnown
      ? "unknown"
      : cutoff !== null && !withinWindow
        ? "outside-window"
        : "within-window";
    filtered.push({ ...space, selected, activityWindowStatus });
  }

  return filtered;
}
