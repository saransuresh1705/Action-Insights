import type {
  WebexConnectionStatus,
  WebexSpaceCatalog,
} from "../../shared/contracts.js";
import type { WebexReadOnlyClient } from "./client.js";
import type { WebexOAuthService } from "./oauth.js";
import type { LocalDatabase } from "../storage/database.js";

export class WebexService {
  public constructor(
    private readonly oauth: WebexOAuthService,
    private readonly client: WebexReadOnlyClient,
    private readonly database?: LocalDatabase,
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
    const spaces = await this.client.listSpaces(accessToken);
    const retrievedAt = new Date().toISOString();
    this.database?.upsertSpaces(spaces, retrievedAt);
    return { spaces, retrievedAt };
  }

  public async disconnect(): Promise<void> {
    await this.oauth.disconnect();
  }
}
