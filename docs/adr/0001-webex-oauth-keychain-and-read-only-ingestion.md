# ADR 0001: Webex OAuth, Keychain, and read-only ingestion

- Status: Accepted
- Date: 12 September 2026
- Governing specification: 1.0, especially FR-AUTH-01 through FR-AUTH-05, FR-SCAN-05 through FR-SCAN-11, §§8.3, 10.2, and 13.1

## Context

Action Insights needs durable personal authorization without placing OAuth secrets or tokens in source code, browser JavaScript, URLs, logs, configuration files, or SQLite. It also needs deterministic read-only retrieval with bounded retries and resumable per-space cursors.

## Decision

The local service implements the Webex OAuth 2.0 authorization-code flow against `https://webexapis.com/v1/authorize` and `https://webexapis.com/v1/access_token`. It requests exactly:

- `spark:messages_read`
- `spark:rooms_read`
- `spark:people_read`
- `spark:kms`

The general Webex API client supports `GET` only and permits only HTTPS URLs under `https://webexapis.com/v1/`. OAuth token exchange is a separate, narrowly scoped adapter because its required token endpoint uses `POST`.

The OAuth client secret, access token, refresh token, expiry metadata, and granted scopes are stored as one versioned macOS Keychain value. Keychain updates supply secret material over standard input instead of process arguments. Refresh-token replacement is performed with one Keychain update.

OAuth callbacks use a single-use, unpredictable, ten-minute state value. Callback query values are never logged. Browser API mutations additionally require the HttpOnly local session cookie and a custom action-request header.

Space and message listing follow Webex `Link` pagination only after revalidating every next URL against the allow-list. HTTP 429 responses honor `Retry-After`; transient server failures use capped exponential backoff with jitter. Scans stop paging after crossing the requested cutoff and update a per-space high-water mark only after the encrypted message batch is committed.

The local SQLite file and its directory use owner-only permissions. AES-256-GCM encrypts message text, space titles, collection names, and collection descriptions with field-specific authenticated context. The encryption key is generated locally and stored in a separate macOS Keychain item. Attachment URLs and contents are discarded.

## Consequences

- A registered Webex Integration and one-time local Keychain setup are required before connection.
- Disconnect can remove user tokens without forcing re-entry of the integration client secret.
- A compromised database file does not directly reveal retained message text or sensitive display names without the separate Keychain key.
- Pagination, token refresh, and per-space failures can be tested without live Webex credentials through injected transport and secret-store boundaries.
- Webex write APIs are structurally absent from the release-1 adapter.

## References

- [Webex Authentication](https://developer.webex.com/messaging/docs/authentication)
- [Webex Integration Scopes](https://developer.webex.com/admin/docs/integration-scopes)
- [Webex API basics and rate limiting](https://developer.webex.com/messaging/docs/basics)
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)
