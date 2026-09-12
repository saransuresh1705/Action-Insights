import { randomBytes } from "node:crypto";
import type { AppConfiguration } from "../config.js";
import type { SecretStore } from "../secrets.js";
import type { WebexConnectionStatus } from "../../shared/contracts.js";
import type { WebexTokenResponse } from "./types.js";

const AUTHORIZE_URL = "https://webexapis.com/v1/authorize";
const TOKEN_URL = "https://webexapis.com/v1/access_token";
const STATE_LIFETIME_MS = 10 * 60 * 1_000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1_000;

interface WebexCredentialEnvelope {
  readonly version: 1;
  readonly clientSecret: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly refreshTokenExpiresAt?: string;
  readonly grantedScopes?: readonly string[];
}

interface PendingAuthorization {
  readonly expiresAt: number;
}

export interface WebexOAuthOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly randomState?: () => string;
}

export class WebexOAuthError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "not-configured"
      | "not-connected"
      | "invalid-state"
      | "token-exchange-failed"
      | "invalid-token-response",
  ) {
    super(message);
    this.name = "WebexOAuthError";
  }
}

export class WebexOAuthService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly randomState: () => string;
  private readonly pending = new Map<string, PendingAuthorization>();

  public constructor(
    private readonly configuration: AppConfiguration,
    private readonly secretStore: SecretStore,
    options: WebexOAuthOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.randomState = options.randomState ?? (() => randomBytes(32).toString("base64url"));
  }

  public async beginAuthorization(): Promise<string> {
    const credentials = await this.readCredentials();
    if (!this.hasConfiguredClientId() || credentials === null) {
      throw new WebexOAuthError("Webex OAuth client configuration is incomplete", "not-configured");
    }

    this.pruneExpiredStates();
    this.pending.clear();
    const state = this.randomState();
    this.pending.set(state, { expiresAt: this.now() + STATE_LIFETIME_MS });

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.configuration.webex.oauthClientId);
    url.searchParams.set("redirect_uri", this.configuration.webex.oauthRedirectUri);
    url.searchParams.set("scope", this.configuration.webex.scopes.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  public async completeAuthorization(code: string, state: string): Promise<void> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (pending === undefined || pending.expiresAt < this.now() || code.length === 0 || code.length > 4_096) {
      throw new WebexOAuthError("Webex OAuth state is invalid or expired", "invalid-state");
    }
    const credentials = await this.requireCredentials();
    const token = await this.exchangeToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.configuration.webex.oauthClientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: this.configuration.webex.oauthRedirectUri,
      }),
    );
    await this.storeToken(credentials.clientSecret, token);
  }

  public async getValidAccessToken(): Promise<string> {
    const credentials = await this.requireCredentials();
    if (credentials.accessToken === undefined || credentials.expiresAt === undefined) {
      throw new WebexOAuthError("Webex is not connected", "not-connected");
    }
    if (Date.parse(credentials.expiresAt) - this.now() > TOKEN_REFRESH_SKEW_MS) {
      return credentials.accessToken;
    }
    if (credentials.refreshToken === undefined) {
      throw new WebexOAuthError("Webex refresh authorization is unavailable", "not-connected");
    }

    const token = await this.exchangeToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.configuration.webex.oauthClientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
      }),
    );
    await this.storeToken(credentials.clientSecret, token);
    return token.access_token;
  }

  public async status(): Promise<WebexConnectionStatus> {
    const credentials = await this.readCredentials();
    const configured = this.hasConfiguredClientId() && credentials !== null;
    if (!configured || credentials === null) {
      return { configured: false, connected: false, tokenHealth: "not-configured", grantedScopes: [] };
    }
    if (credentials.accessToken === undefined || credentials.expiresAt === undefined) {
      return { configured: true, connected: false, tokenHealth: "disconnected", grantedScopes: [] };
    }
    const expired = Date.parse(credentials.expiresAt) <= this.now();
    return {
      configured: true,
      connected: true,
      tokenHealth: expired ? "expired" : "healthy",
      expiresAt: credentials.expiresAt,
      grantedScopes: credentials.grantedScopes ?? [],
    };
  }

  public async disconnect(): Promise<void> {
    const credentials = await this.readCredentials();
    if (credentials !== null) {
      await this.secretStore.set(
        this.configuration.webex.credentialRef,
        JSON.stringify({ version: 1, clientSecret: credentials.clientSecret } satisfies WebexCredentialEnvelope),
      );
    }
    this.pending.clear();
  }

  private async exchangeToken(body: URLSearchParams): Promise<WebexTokenResponse> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
    });
    if (!response.ok) {
      throw new WebexOAuthError(`Webex token exchange failed with status ${response.status}`, "token-exchange-failed");
    }
    const value = (await response.json()) as unknown;
    if (!isTokenResponse(value)) {
      throw new WebexOAuthError("Webex returned an invalid token response", "invalid-token-response");
    }
    return value;
  }

  private async storeToken(clientSecret: string, token: WebexTokenResponse): Promise<void> {
    const now = this.now();
    const grantedScopes = parseScopes(token.scope);
    if (
      grantedScopes.length !== this.configuration.webex.scopes.length ||
      this.configuration.webex.scopes.some((scope) => !grantedScopes.includes(scope))
    ) {
      throw new WebexOAuthError("Webex did not grant the approved read-only scope set", "invalid-token-response");
    }
    const envelope: WebexCredentialEnvelope = {
      version: 1,
      clientSecret,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(now + token.expires_in * 1_000).toISOString(),
      grantedScopes,
      ...(token.refresh_token_expires_in === undefined
        ? {}
        : { refreshTokenExpiresAt: new Date(now + token.refresh_token_expires_in * 1_000).toISOString() }),
    };
    await this.secretStore.set(this.configuration.webex.credentialRef, JSON.stringify(envelope));
  }

  private async requireCredentials(): Promise<WebexCredentialEnvelope> {
    const credentials = await this.readCredentials();
    if (!this.hasConfiguredClientId() || credentials === null) {
      throw new WebexOAuthError("Webex OAuth client configuration is incomplete", "not-configured");
    }
    return credentials;
  }

  private async readCredentials(): Promise<WebexCredentialEnvelope | null> {
    const stored = await this.secretStore.get(this.configuration.webex.credentialRef);
    if (stored === null) return null;
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (isCredentialEnvelope(parsed)) return parsed;
    } catch {
      // A raw Keychain value is the initial client secret before the first OAuth exchange.
    }
    if (!isBoundedSecret(stored)) {
      throw new WebexOAuthError("Stored Webex client configuration is invalid", "not-configured");
    }
    return { version: 1, clientSecret: stored };
  }

  private hasConfiguredClientId(): boolean {
    const value = this.configuration.webex.oauthClientId;
    return value !== "not-configured" && !value.startsWith("replace-");
  }

  private pruneExpiredStates(): void {
    const now = this.now();
    for (const [state, pending] of this.pending) {
      if (pending.expiresAt < now) this.pending.delete(state);
    }
  }
}

function isCredentialEnvelope(value: unknown): value is WebexCredentialEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    isBoundedSecret(record.clientSecret) &&
    isOptionalBoundedSecret(record.accessToken) &&
    isOptionalBoundedSecret(record.refreshToken) &&
    isOptionalDate(record.expiresAt) &&
    isOptionalDate(record.refreshTokenExpiresAt) &&
    (record.grantedScopes === undefined ||
      (Array.isArray(record.grantedScopes) && record.grantedScopes.every((scope) => typeof scope === "string")))
  );
}

function isTokenResponse(value: unknown): value is WebexTokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isBoundedSecret(record.access_token) &&
    isBoundedSecret(record.refresh_token) &&
    typeof record.expires_in === "number" &&
    Number.isFinite(record.expires_in) &&
    record.expires_in > 0
  );
}

function isBoundedSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 65_536 && !/[\u0000\r\n]/u.test(value);
}

function isOptionalBoundedSecret(value: unknown): value is string | undefined {
  return value === undefined || isBoundedSecret(value);
}

function isOptionalDate(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function parseScopes(scope: string | undefined): readonly string[] {
  return scope === undefined ? [] : scope.split(/\s+/u).filter((entry) => entry !== "").sort();
}
