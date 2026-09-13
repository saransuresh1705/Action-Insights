# Action Insights

Action Insights is a local-first application that reviews selected Webex conversations, summarizes activity, identifies likely user actions, drafts responses, and produces read-only, evidence-backed recommendations.

## Project status

**Implementation phase — specification 1.1 is approved.**

The authoritative product and technical specification is [docs/technical-specification.md](docs/technical-specification.md). All product changes must be proposed there, reviewed, and approved before implementation.

The current foundation includes:

- a dependency-light TypeScript service and browser client;
- loopback-only HTTP serving with session-protected local APIs;
- strict configuration validation with OS Keychain credential references;
- a deny-by-default action policy that permits reads and local drafts only;
- structured, allow-listed logging that excludes message and identity content;
- Webex OAuth with exact state validation and server-only token refresh;
- GET-only space and message adapters with safe pagination and rate-limit handling;
- a configurable 30-day recent-activity catalog filter that preserves selected older spaces;
- encrypted SQLite storage for message text and sensitive display names;
- app-local Watched Collections and manual incremental scans; and
- a constrained OpenAI Responses adapter with structured outputs, evidence grounding, and minimized-storage controls;
- encrypted per-space summaries and action candidates with locally preserved review feedback; and
- an accessible local dashboard for connection, discovery, selection, summaries, action review, and scan progress.

Response drafting, read-only enterprise connectors, deletion reconciliation, and production hardening remain future implementation slices.

## Prerequisites

- Node.js 22.13 or later
- pnpm 11

## Local development

```sh
pnpm install
mkdir -p ~/.config/webex-action-insights
cp config/action-insights.example.json ~/.config/webex-action-insights/config.json
pnpm verify
pnpm start
```

Open `http://127.0.0.1:4318`. The service never binds to a non-loopback interface.

The example configuration contains only non-secret values and OS Keychain references. Do not put tokens, client secrets, message content, or personal data in configuration files. Machine-local configuration files are ignored by Git.

## Webex OAuth setup

1. Create a Webex Integration in [My Webex Apps](https://developer.webex.com/my-apps/new/integration).
2. Register `http://127.0.0.1:4318/oauth/webex/callback` as its redirect URI.
3. Select only `spark:messages_read`, `spark:rooms_read`, and `spark:people_read`. Webex also requires `spark:kms` when encrypted message content is read.
4. Put the non-secret client ID in `~/.config/webex-action-insights/config.json`.
5. Store the client secret in macOS Keychain using the prompt-based command below. Enter the secret only when Keychain prompts; it is not placed in the command or shell history.

```sh
security add-generic-password -U -a webex-oauth -s webex-action-insights -w
```

After OAuth completes, access and refresh tokens are kept in the same Keychain item. Disconnect removes those tokens while retaining the integration client secret so the account can be reconnected.

The application never downloads Webex attachments. It records only whether a message has an attachment.

## OpenAI analysis setup

Phase 2 uses the approved `gpt-5.6-sol` Responses API profile. Store the API key in the configured macOS Keychain entry using this prompt-based command; enter the key only at the Keychain prompt so it is not written to the command or shell history.

```sh
security add-generic-password -U -a openai -s webex-action-insights -w
```

Then open the local app and accept the first-use external-processing disclosure. Until both the Keychain entry and local acknowledgment exist, Webex ingestion continues but model analysis is skipped. Each request is single-space, foreground, and stateless; it sets `store: false`, disables background mode, uses explicit prompt caching without a cache key, supplies no tools, and validates all cited message IDs locally.

Selected message content leaves the device for OpenAI processing and is subject to OpenAI's accepted default API retention. The app does not write model request or response content to logs or any non-local application store.

## Commands

- `pnpm typecheck` checks server, browser, and test TypeScript projects.
- `pnpm test` compiles and runs the Node test suite.
- `pnpm build` creates the production files in `dist/`.
- `pnpm verify` runs all three checks.
- `pnpm dev` rebuilds and runs the server in watch mode.

## Safety baseline

Release 1 is designed as a read-only decision-support tool. It must not send Webex messages or modify Jira, GitHub, Confluence, SharePoint, calendars, email, repositories, or other external systems.

Credentials, machine-local configuration, message caches, local databases, logs, and exports must never be committed to this repository.
