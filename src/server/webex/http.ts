export const WEBEX_API_ORIGIN = "https://webexapis.com";
const WEBEX_API_PREFIX = "/v1/";

export class WebexApiError extends Error {
  public constructor(
    message: string,
    public readonly code: "invalid-url" | "rate-limited" | "request-failed" | "invalid-response",
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "WebexApiError";
  }
}

export interface WebexPage<T> {
  readonly items: readonly T[];
  readonly nextUrl?: string;
}

export interface WebexHttpOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly maxRetries?: number;
}

export class WebexReadOnlyHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;

  public constructor(options: WebexHttpOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.maxRetries = options.maxRetries ?? 3;
  }

  public async getPage<T>(url: string, accessToken: string, signal?: AbortSignal): Promise<WebexPage<T>> {
    assertAllowedWebexUrl(url);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        ...(signal === undefined ? {} : { signal }),
      });

      if (response.ok) {
        const payload = (await response.json()) as unknown;
        if (!isListResponse<T>(payload)) {
          throw new WebexApiError("Webex returned an invalid list response", "invalid-response", response.status);
        }
        const nextUrl = nextPageUrl(response.headers.get("link"));
        if (nextUrl !== undefined) assertAllowedWebexUrl(nextUrl);
        return nextUrl === undefined ? { items: payload.items } : { items: payload.items, nextUrl };
      }

      const retryDelay = retryDelayMilliseconds(response, attempt, this.random);
      if (retryDelay !== null && attempt < this.maxRetries) {
        await this.sleep(retryDelay);
        continue;
      }

      const code = response.status === 429 ? "rate-limited" : "request-failed";
      throw new WebexApiError(`Webex request failed with status ${response.status}`, code, response.status);
    }

    throw new WebexApiError("Webex request retry limit exceeded", "request-failed");
  }

  public async getOne<T>(url: string, accessToken: string, signal?: AbortSignal): Promise<T> {
    assertAllowedWebexUrl(url);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      throw new WebexApiError(`Webex request failed with status ${response.status}`, "request-failed", response.status);
    }
    return (await response.json()) as T;
  }
}

export function assertAllowedWebexUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebexApiError("Webex request URL is invalid", "invalid-url");
  }
  if (
    url.origin !== WEBEX_API_ORIGIN ||
    !url.pathname.startsWith(WEBEX_API_PREFIX) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new WebexApiError("Webex request URL is outside the allow-listed API origin", "invalid-url");
  }
}

function nextPageUrl(linkHeader: string | null): string | undefined {
  if (linkHeader === null) return undefined;
  for (const part of linkHeader.split(",")) {
    const segments = part.split(";").map((segment) => segment.trim());
    const target = /^<([^>]+)>$/u.exec(segments[0] ?? "")?.[1];
    const isNext = segments.slice(1).some((segment) => /^rel="?next"?$/u.test(segment));
    if (target !== undefined && isNext) return target;
  }
  return undefined;
}

function retryDelayMilliseconds(response: Response, attempt: number, random: () => number): number | null {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
  }
  if (response.status >= 500 && response.status <= 599) {
    return 250 * 2 ** attempt + Math.floor(random() * 250);
  }
  return null;
}

function isListResponse<T>(value: unknown): value is { readonly items: readonly T[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items);
}
