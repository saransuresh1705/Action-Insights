# Action Insights

Action Insights is a local-first application that reviews selected Webex conversations, summarizes activity, identifies likely user actions, drafts responses, and produces read-only, evidence-backed recommendations.

## Project status

**Implementation phase — specification 1.0 is approved.**

The authoritative product and technical specification is [docs/technical-specification.md](docs/technical-specification.md). All product changes must be proposed there, reviewed, and approved before implementation.

The current foundation includes:

- a dependency-light TypeScript service and browser client;
- loopback-only HTTP serving with session-protected local APIs;
- strict configuration validation with OS Keychain credential references;
- a deny-by-default action policy that permits reads and local drafts only;
- structured, allow-listed logging that excludes message and identity content; and
- the initial accessible dashboard shell.

Webex OAuth, message ingestion, the encrypted local data store, model orchestration, and read-only enterprise connectors are the next implementation slices.

## Prerequisites

- Node.js 22.12 or later
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

## Commands

- `pnpm typecheck` checks server, browser, and test TypeScript projects.
- `pnpm test` compiles and runs the Node test suite.
- `pnpm build` creates the production files in `dist/`.
- `pnpm verify` runs all three checks.
- `pnpm dev` rebuilds and runs the server in watch mode.

## Safety baseline

Release 1 is designed as a read-only decision-support tool. It must not send Webex messages or modify Jira, GitHub, Confluence, SharePoint, calendars, email, repositories, or other external systems.

Credentials, machine-local configuration, message caches, local databases, logs, and exports must never be committed to this repository.
