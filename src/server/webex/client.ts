import type { WebexIdentity, WebexSpaceSummary } from "../../shared/contracts.js";
import { WEBEX_API_ORIGIN, WebexReadOnlyHttpClient, type WebexPage } from "./http.js";
import type { WebexListResponse, WebexMessage, WebexPerson, WebexRoom } from "./types.js";

export class WebexReadOnlyClient {
  public constructor(private readonly http: WebexReadOnlyHttpClient) {}

  public async listSpaces(accessToken: string, signal?: AbortSignal): Promise<readonly WebexSpaceSummary[]> {
    const rooms = await this.collectPages<WebexRoom>(`${WEBEX_API_ORIGIN}/v1/rooms?max=100&sortBy=lastactivity`, accessToken, signal);
    return rooms.map((room) => ({
      id: room.id,
      title: room.title,
      type: room.type,
      ...(room.lastActivity === undefined ? {} : { lastActivity: room.lastActivity }),
      selected: false,
    }));
  }

  public async listMessagePages(
    roomId: string,
    accessToken: string,
    onPage: (messages: readonly WebexMessage[]) => boolean | Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<void> {
    let nextUrl: string | undefined = messageListUrl(roomId);
    const visited = new Set<string>();
    while (nextUrl !== undefined) {
      if (visited.has(nextUrl) || visited.size >= 10_000) {
        throw new Error("Webex message pagination did not terminate safely");
      }
      visited.add(nextUrl);
      const page: WebexPage<WebexMessage> = await this.http.getPage<WebexMessage>(nextUrl, accessToken, signal);
      if (!(await onPage(page.items))) return;
      nextUrl = page.nextUrl;
    }
  }

  public async getCurrentUser(accessToken: string, signal?: AbortSignal): Promise<WebexIdentity> {
    const person = await this.http.getOne<WebexPerson>(`${WEBEX_API_ORIGIN}/v1/people/me`, accessToken, signal);
    return { id: person.id, displayName: person.displayName, emails: person.emails ?? [] };
  }

  private async collectPages<T>(url: string, accessToken: string, signal?: AbortSignal): Promise<readonly T[]> {
    const items: T[] = [];
    let nextUrl: string | undefined = url;
    const visited = new Set<string>();
    while (nextUrl !== undefined) {
      if (visited.has(nextUrl) || visited.size >= 10_000) {
        throw new Error("Webex pagination did not terminate safely");
      }
      visited.add(nextUrl);
      const page: WebexPage<T> = await this.http.getPage<T>(nextUrl, accessToken, signal);
      items.push(...page.items);
      nextUrl = page.nextUrl;
    }
    return items;
  }
}

function messageListUrl(roomId: string): string {
  const url = new URL(`${WEBEX_API_ORIGIN}/v1/messages`);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("max", "100");
  return url.toString();
}

// Retained to make the expected collection envelope explicit at the adapter boundary.
export type WebexRoomListResponse = WebexListResponse<WebexRoom>;
