# Action Insights

Action Insights is a planned local-first application that reviews selected Webex conversations, summarizes activity, identifies likely user actions, drafts responses, and produces read-only, evidence-backed recommendations.

## Project status

**Specification phase — application development is not yet approved.**

The authoritative product and technical specification is [docs/technical-specification.md](docs/technical-specification.md). Implementation may begin only after the specification's feasibility gates, open decisions, and approval requirements are satisfied.

## Safety baseline

Release 1 is designed as a read-only decision-support tool. It must not send Webex messages or modify Jira, GitHub, Confluence, SharePoint, calendars, email, repositories, or other external systems.

Credentials, machine-local configuration, message caches, local databases, logs, and exports must never be committed to this repository.

