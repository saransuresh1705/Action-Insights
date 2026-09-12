export interface WebexTokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly refresh_token_expires_in?: number;
  readonly scope?: string;
  readonly token_type?: string;
}

export interface WebexRoom {
  readonly id: string;
  readonly title: string;
  readonly type: "direct" | "group";
  readonly lastActivity?: string;
  readonly created?: string;
  readonly creatorId?: string;
  readonly teamId?: string;
}

export interface WebexMessage {
  readonly id: string;
  readonly roomId: string;
  readonly roomType?: "direct" | "group";
  readonly text?: string;
  readonly markdown?: string;
  readonly html?: string;
  readonly personId?: string;
  readonly personEmail?: string;
  readonly created: string;
  readonly updated?: string;
  readonly parentId?: string;
  readonly mentionedPeople?: readonly string[];
  readonly files?: readonly string[];
}

export interface WebexPerson {
  readonly id: string;
  readonly displayName: string;
  readonly emails?: readonly string[];
}

export interface WebexListResponse<T> {
  readonly items: readonly T[];
}

export interface NormalizedWebexMessage {
  readonly id: string;
  readonly roomId: string;
  readonly parentId?: string;
  readonly authorId?: string;
  readonly created: string;
  readonly updated?: string;
  readonly text: string;
  readonly mentionedPeople: readonly string[];
  readonly hasAttachments: boolean;
  readonly contentHash: string;
}

