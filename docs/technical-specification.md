# Webex Action Insights — Product and Technical Specification

| Field | Value |
|---|---|
| Working title | Webex Action Insights |
| Document version | 0.7-draft |
| Status | **Draft — not approved for implementation** |
| Date | 12 September 2026 |
| Intended deployment | Single-user, local-first application |
| Primary user | The authenticated Webex user |
| Canonical repository | `https://github.com/saransuresh1705/Action-Insights` |
| Canonical specification path | `docs/technical-specification.md` |
| Change policy | Specification-first; see §18 |

## 1. Purpose

Webex Action Insights is a local-first application that periodically reviews messages in user-selected Webex spaces, summarizes conversations, identifies items that may require the user's attention, drafts possible responses, and recommends ways to complete non-message work.

The application is an analysis and decision-support tool. Release 1 does **not** send messages, create or update tickets, modify documents, schedule meetings, change repositories, or perform any other external side effect. The user remains the decision-maker and actor.

## 2. Goals

1. Reduce the time required to understand activity across selected Webex spaces.
2. Make likely obligations visible, traceable to their source messages, and easy to triage.
3. Distinguish “reply in Webex” from work that must happen elsewhere.
4. Produce useful response drafts and evidence-backed action recommendations.
5. Use read-only enterprise connectors, including MCP servers, to improve recommendations when the user enables them.
6. Keep credentials and message data under the user's control.
7. Prevent the agentic layer from taking consequential actions or being manipulated by message content.

## 3. Non-goals for release 1

- Sending, editing, or deleting a Webex message.
- Creating, editing, transitioning, merging, approving, or deleting content in Jira, GitHub, Confluence, SharePoint, calendars, email, or other systems.
- Organization-wide surveillance or access to spaces the authenticated user cannot access.
- Reading meeting chat, recordings, transcripts, whiteboards, or files by default.
- Monitoring spaces that the user has not explicitly selected.
- Automatically deciding that an obligation is complete based only on model inference.
- Replacing Webex retention, compliance, eDiscovery, or records-management systems.
- Multi-user or cloud-hosted operation.

## 4. User requirements and disposition

| ID | Source requirement | Release 1 disposition |
|---|---|---|
| UR-01 | Read messages across all Webex spaces at configurable intervals. | Supported for explicitly selected spaces. “All joined spaces” may be enabled, but new spaces require a visible opt-in policy. Incremental reads and configurable backfill are required. |
| UR-02 | Summarize each space in configurable Webex sections. | Supported through app-managed **Watched Collections** that mirror Webex sections. This release-1 approach was approved by the user on 12 September 2026 because no public native-section API has been identified. |
| UR-03 | Highlight action messages and space; link to the specific message. | Feasible for the macOS Webex desktop client through a `webexteams:` exact-message URI. The message parameter is not publicly documented by Cisco, so implementation must use the validated compatibility adapter and tests in §6.10 and §15. If compatibility fails, the user-approved fallback opens the space and shows a warning plus timestamp, author, snippet, and copyable source reference. |
| UR-04 | Identify action type and suggest categories. | Supported through the taxonomy in §6.7. |
| UR-05 | Generate response drafts with copy option. | Supported. Copy only; no Send button in release 1. |
| UR-06 | Recommend actions and use Jira/GitHub/Confluence/SharePoint/Cisco tools. | Supported through allow-listed, read-only connectors. Recommendations must cite retrieved evidence. |
| UR-07 | Do not automatically execute actions. | Hard invariant. Release 1 has no external write capability. |
| UR-08 | Agentic backend orchestrates recommendation and execution layers. | Supported as a bounded orchestration layer plus a policy-controlled tool broker. The execution interface exists architecturally but all side-effecting operations are disabled in release 1. |
| UR-09 | UI for configuration, summaries, actionables, drafts, and recommendations. | Supported as a local HTML application. |
| UR-10 | Guardrails against serious consequences. | Supported; see §11. |
| UR-11 | No credentials in code; use local configuration. | Supported using non-secret local configuration plus credential references to secure local storage; see §10. The OS credential-store design was approved by the user on 12 September 2026. |
| UR-12 | HTML UI; get approval before using another language. | HTML/CSS is retained for presentation. **TypeScript on Node.js is approved** for the local service and browser code as of 12 September 2026. |
| UR-13 | Detailed specification before development; future changes go through spec review and approval. | This document establishes that governance; see §18. The specification and application code shall be versioned together in the canonical GitHub repository. |

## 5. Key product concepts

### 5.1 Space

A Webex “space,” represented as a `room` by the Webex Messaging API. The application may only retrieve content visible to the authenticated user.

### 5.2 Watched Collection

An app-local group of one or more Webex spaces. It is intended to mirror a Webex space section but does not claim to be synchronized with Webex unless a supported section API is validated.

Each collection contains:

- Collection name and optional description.
- Selected Webex space IDs and display names.
- Include/exclude rules for direct-message and group spaces.
- Scan schedule override, if any.
- Initial history window.
- Summary preferences and optional context notes.
- Sensitivity and connector restrictions.

A space may appear in more than one collection but is ingested only once per scan.

### 5.3 Scan

A scheduled or manually initiated incremental retrieval and analysis run. A scan has a unique ID, start/end timestamps, selected spaces, cursor state, outcome, warnings, cost/usage metadata, and an audit record.

### 5.4 Insight

A model-generated, evidence-linked observation about a conversation. An insight is either a summary item or an action candidate. It is never presented as source truth.

### 5.5 Action candidate

A message or message thread that the application believes may require attention from the user. Every candidate contains source evidence, a confidence score, a category, rationale, suggested next steps, and a user-controlled status.

## 6. Functional requirements

### 6.1 Authentication and identity

**FR-AUTH-01** The app shall authenticate the user through a Webex OAuth integration, not a production personal developer token.

**FR-AUTH-02** The app shall request the minimum release-1 scopes: message read, room read, and identity/profile read only where required. It shall not request Webex message-write, room-write, membership-write, or webhook-write scopes.

**FR-AUTH-03** The app shall display the authenticated Webex identity, granted scopes, token health, and a Disconnect control.

**FR-AUTH-04** Disconnect shall revoke or discard locally held authorization material where the platform permits and stop future scans.

**FR-AUTH-05** Tokens and client secrets shall never be exposed to browser JavaScript, URLs, model prompts, logs, exports, or the local database.

### 6.2 Space discovery and selection

**FR-SPACE-01** The app shall list spaces available to the authenticated user, including title, type, last activity when available, and selection state.

**FR-SPACE-02** The user shall be able to search, filter, bulk-select, and deselect spaces.

**FR-SPACE-03** The user shall be able to create, rename, reorder, and delete Watched Collections without changing Webex.

**FR-SPACE-04** The app shall support these monitoring policies:

- Selected spaces only (default).
- All currently joined spaces.
- All currently and subsequently joined spaces, with a prominent data-scope warning.

**FR-SPACE-05** Newly discovered spaces shall be listed in a review queue unless the user explicitly enabled automatic inclusion.

**FR-SPACE-06** The app shall show spaces it can no longer access and allow removal from a collection without deleting historical derived insights unless the user chooses to do so.

**FR-SPACE-07** Direct-message spaces shall be included in the release-1 space catalog and default monitoring scope. The user may deselect individual direct-message spaces or exclude all direct messages. Their inclusion does not relax any privacy, isolation, logging, retention, or external-processing control.

### 6.3 Scheduling and ingestion

**FR-SCAN-01** The user shall configure a global scan interval and optional per-collection overrides.

**FR-SCAN-01A** In release 1, scheduled scans run only while the application is open. The UI shall explain that closing the app pauses monitoring. Installing or enabling an operating-system background service requires a future specification revision and separate user approval.

**FR-SCAN-02** Supported presets shall include manual, 15 minutes, 30 minutes, 1 hour, 2 hours, 4 hours, and daily. A custom interval shall be allowed with a safe minimum of 5 minutes.

**FR-SCAN-03** The scheduler shall use the configured IANA time zone and show the next planned run.

**FR-SCAN-04** If the local app is stopped or the computer sleeps, missed runs shall not stack. One catch-up run shall begin after restart/wake, followed by the normal schedule.

**FR-SCAN-05** Initial backfill shall default to the user-approved 30 days and be configurable to 7, 90, 180, or 365 days, or full available history. “Full available history” shall require a warning about duration, rate limits, model usage, and local data volume.

**FR-SCAN-06** Subsequent scans shall be incremental using a per-space high-water mark. Overlap shall be used to tolerate clock skew, late edits, threads, and eventual consistency; processing shall be idempotent by message ID plus content version/hash.

**FR-SCAN-07** The scanner shall paginate correctly, obey Webex rate limits, respect `Retry-After` on HTTP 429, cap retries, add jittered backoff, and resume without duplicating insights.

**FR-SCAN-08** A manual “Scan now” action shall show progress and may be cancelled without corrupting cursors.

**FR-SCAN-09** The app shall record partial failures per space and shall not describe a partial scan as complete.

**FR-SCAN-10** Message deletions and edits detected by subsequent retrieval shall mark linked insights stale or update them; source text shall not be silently retained after deletion beyond the configured retention policy.

**FR-SCAN-11** File attachments shall not be downloaded or analyzed in release 1. Minimal attachment metadata required to show that a source message contains an attachment may be recorded locally, but shall not be sent to a model or connector. Any attachment-content analysis requires a future approved specification revision.

### 6.4 Context preparation

**FR-CTX-01** The analysis context shall preserve space, author, timestamp, message ID, parent/thread relationship, mentions, and chronological order.

**FR-CTX-02** The app shall include a bounded amount of preceding and threaded context so that isolated sentences are not classified without conversational context.

**FR-CTX-03** Messages authored by the user shall be used to determine whether an apparent request has already been answered or delegated.

**FR-CTX-04** Content from one space shall never be shown to a connector, model call, summary, or action candidate for another space unless an explicit cross-space synthesis feature is approved later.

**FR-CTX-05** Reactions, edits, and threads shall be represented when the API makes them available. Unsupported content types shall be visibly labelled rather than guessed.

### 6.5 Per-space summaries

**FR-SUM-01** The app shall produce a summary for each selected space for the configured period.

**FR-SUM-02** Each summary shall contain, where present:

- Period and coverage status.
- Main topics.
- Decisions or agreements.
- Open questions.
- Risks or blockers.
- Action candidates involving the user.
- Other team actions, clearly separated from the user's actions.
- Important links or referenced artifacts.
- “No material activity” when appropriate.

**FR-SUM-03** Summary statements shall link to one or more source messages or provide source message references.

**FR-SUM-04** The user shall choose concise, standard, or detailed summaries and an output language.

**FR-SUM-05** The app shall support “Copy summary” and export of a user-selected summary. It shall not post summaries into Webex in release 1.

**FR-SUM-06** Summaries shall be displayed in this application. Release 1 shall not post a summary, summary link, notification, or status message into Webex; doing so would violate the release-1 no-write posture.

### 6.6 Action detection

**FR-ACT-01** An item shall be considered a user action candidate only when there is evidence that the authenticated user is the intended owner, approver, respondent, or necessary participant.

Signals may include direct mention, direct message, explicit assignment, name reference, prior ownership, an unanswered question directed to the user, or an agreed follow-up. A message sent to `@all` is not sufficient by itself.

**FR-ACT-02** Every candidate shall show:

- Space name and collection.
- Source author and timestamp.
- Exact source snippet.
- Thread/context preview.
- Source message ID.
- “Open in Webex” link status.
- Primary and optional secondary category.
- Confidence: High, Medium, or Low, plus a numeric score retained internally.
- Why the app believes action is needed.
- Detected owner, due date, urgency, and dependencies, or “not specified.”
- Recommended next step.
- Model and analysis timestamp.

**FR-ACT-03** Candidates below the configured threshold shall appear in “Needs review,” not the main action list.

**FR-ACT-04** The user shall set status to New, Reviewed, In progress, Snoozed, Resolved, Dismissed, or Not mine.

**FR-ACT-05** The user shall be able to correct category, owner, due date, and confidence feedback. Corrections shall not rewrite the source message.

**FR-ACT-06** The app shall deduplicate candidates arising from repeated mentions or multiple messages in the same request thread and shall retain all supporting evidence.

**FR-ACT-07** The app shall re-evaluate open candidates when later messages indicate completion, cancellation, reassignment, or changed requirements. It may suggest a status change but shall not silently resolve an item.

### 6.7 Action taxonomy

| Category | Meaning | Default output |
|---|---|---|
| Reply required | A response in Webex appears necessary. | Draft reply, questions to clarify, tone options. |
| Acknowledgement | A short confirmation or receipt is likely enough. | Concise acknowledgement draft. |
| Decision / approval | The user is asked to choose, approve, reject, or sign off. | Options, decision criteria, missing evidence; never decide for the user. |
| Review / feedback | The user must inspect an artifact or provide comments. | Review checklist, artifact links, suggested feedback structure. |
| External work item | Work is requested in Jira, GitHub, Confluence, SharePoint, or another system. | Read-only context lookup and sequenced completion plan. |
| Research / information | The user must find or supply facts. | Research questions, likely sources, evidence-backed recommendation. |
| Meeting / scheduling | Attendance, scheduling, agenda, or meeting preparation is needed. | Proposed preparation or scheduling steps; no calendar write. |
| Follow-up / reminder | The user committed to revisit something later. | Follow-up date suggestion and checklist; local snooze only. |
| Blocker / dependency | Progress depends on the user or on resolving a dependency. | Impact, owner, unblock options, escalation considerations. |
| Risk / escalation | A security, delivery, compliance, customer, or operational risk is raised. | Risk summary, safe escalation path, required human review. |
| Delegation candidate | Another person appears better positioned, but the user owns routing. | Suggested delegate and handoff note; no assignment. |
| FYI / no action | Material information with no supported user obligation. | Summary only; excluded from action count. |
| Ambiguous | The evidence is insufficient or conflicting. | Clarifying questions and “Needs review” status. |

The user may enable/disable categories and define aliases, but may not disable the “Ambiguous” or “Risk / escalation” safeguards.

### 6.8 Response drafting

**FR-RESP-01** “Reply required” and “Acknowledgement” candidates shall include a proposed response grounded only in the selected message context and user-configured preferences.

**FR-RESP-02** The draft shall not claim that work has been completed, approved, tested, scheduled, or verified unless the supporting context proves it.

**FR-RESP-03** If key information is missing, the default draft shall ask a clarifying question rather than invent details.

**FR-RESP-04** The user shall be able to choose tone (concise, neutral, warm, formal) and regenerate. Regeneration shall preserve a visible draft history for the current session.

**FR-RESP-05** A Copy control shall use the browser Clipboard API, provide success/failure feedback, and copy only the selected draft text.

**FR-RESP-06** There shall be no Send, Post, Reply, or Auto-reply capability in release 1.

### 6.9 Action recommendations and connectors

**FR-REC-01** For non-reply categories, the app shall generate a practical, ordered plan describing what the user could do, what information is missing, and what outcome would indicate completion.

**FR-REC-02** Recommendations shall distinguish:

- Facts found in Webex or connected systems.
- Model inference.
- User decisions still required.
- Actions that would have side effects.

**FR-REC-03** The user may enable individual read-only MCP or API connectors for systems such as Jira, GitHub, Confluence, SharePoint, and approved Cisco tools.

**FR-REC-04** Each connector shall have an explicit allow-list of tools/operations, data scopes, domains/projects/spaces, and maximum calls per analysis.

**FR-REC-05** Release 1 shall reject connector tools that create, update, transition, approve, merge, send, invite, upload, delete, or otherwise mutate external state—even if such a tool is exposed by the MCP server.

**FR-REC-06** Connector results shall be treated as untrusted content and shall be scanned for prompt-injection patterns before entering model context.

**FR-REC-07** The recommendation shall cite the retrieved issue, pull request, page, or file using a stable link where available and shall disclose connector failures or stale data.

**FR-REC-08** If no suitable connector is enabled, the app shall give a generic plan and identify what connector or information could improve it.

### 6.10 Source navigation

**FR-LINK-01** The app shall generate exact-message navigation through a dedicated, versioned Webex link adapter. The release-1 desktop URI format is:

```text
webexteams://im?space=<space-uuid>&message=<message-uuid>
```

The adapter shall derive the UUIDs only from validated Webex API identifiers. Under the currently observed identifier representation, the URL-safe Base64 room ID decodes to `ciscospark://us/ROOM/<uuid>` and the message ID decodes to `ciscospark://us/MESSAGE/<uuid>`. The adapter shall verify the expected resource prefix and canonical UUID syntax before constructing a URI. It shall fail closed on an unknown representation.

**FR-LINK-02** Because Cisco's public protocol page documents `webexteams://im?space=<space-uuid>` but does not document the `message` parameter, the exact-message form shall be treated as a compatibility feature rather than a guaranteed API contract. Its URI construction logic shall be isolated, covered by tests, and disableable without affecting ingestion or source references.

**FR-LINK-03** “Open exact message in Webex” shall use a normal user-initiated hyperlink and clearly state that it opens the Webex desktop app. The app shall never launch Webex automatically. The browser may ask the user to confirm the external-app launch.

**FR-LINK-04** If exact-message navigation is unsupported, fails, or is disabled, the user-approved fallback shall use the documented space URI and display author, timestamp, snippet, and a copyable source reference. The action card shall label this as “Open space,” not imply exact navigation, retain a “Copy source reference” control, and show a compatibility warning explaining that Webex could not open the exact message.

**FR-LINK-05** No exact-message HTTPS URL for the Webex web client has been confirmed. Release 1 shall not fabricate one. Web-client exact navigation remains out of scope unless Cisco documents a stable format or a later approved compatibility test establishes one.

**FR-LINK-06** URI generation shall reject arbitrary schemes, injected query parameters, non-Webex identifiers, control characters, and identifiers obtained from model output. Only server-side source records created by the Webex ingestion adapter may supply link inputs.

### 6.11 Search, filters, and export

**FR-UI-01** The user shall filter actions by collection, space, category, confidence, status, due date, author, and scan period.

**FR-UI-02** Search shall operate over locally retained summaries and action candidates. Raw message search is out of scope unless later approved.

**FR-UI-03** Exports shall be manually initiated, previewed, and limited to selected fields. Credentials, hidden prompts, raw connector payloads, and unrelated source messages shall never be exported.

## 7. Primary user experience

### 7.1 First-run setup

1. Welcome and privacy explanation.
2. Select local data directory and retention policy.
3. Connect Webex through OAuth and review read-only scopes.
4. Discover spaces.
5. Create one or more Watched Collections and select spaces.
6. Select scan schedule and backfill window.
7. Configure summary and action preferences.
8. Optionally enable read-only connectors.
9. Review estimated data scope and confirm first scan.

### 7.2 Dashboard

The default dashboard shall show:

- Last scan result, next scan, and a Scan now control.
- New and overdue action counts.
- “Needs review” count.
- Recent collection and per-space summaries.
- Connector and authentication warnings.
- Coverage warnings for partial or rate-limited scans.

### 7.3 Action inbox

Each action appears as a compact card. Expanding it reveals source context, rationale, draft or recommendation, connector evidence, confidence, and user status controls. The application shall prioritize traceability over decorative scoring.

### 7.4 Configuration

Configuration areas:

- Webex account and permissions.
- Collections and selected spaces.
- Schedule, time zone, backfill, and catch-up behavior.
- Summary length, language, and response tone.
- Action categories and confidence threshold.
- Data retention and deletion.
- Model provider/endpoint and usage budget.
- MCP/connectors, tool allow-lists, and connector scope.
- Audit log and diagnostics.

## 8. System architecture

```text
Local browser UI (HTML/CSS/JS)
          |
          | loopback HTTP + authenticated session
          v
Local application service
  +-- Configuration and secret-reference resolver
  +-- Scheduler and scan coordinator
  +-- Webex read-only ingestion adapter
  +-- Normalizer / thread context builder
  +-- Agent orchestrator (bounded state machine)
  +-- Policy engine and guardrail evaluator
  +-- Read-only MCP/API tool broker
  +-- Summary, action, and response services
  +-- Audit and diagnostics service
          |
          +-- Encrypted local database
          +-- OS credential store
          +-- Approved model endpoint
          +-- Webex APIs
          +-- Allow-listed read-only enterprise connectors
```

### 8.1 Local HTML UI

The UI shall be served only on a loopback address by the local service. It shall use semantic HTML, accessible CSS, and browser JavaScript. It shall not contain OAuth client secrets or call privileged APIs directly.

### 8.2 Local service

The service is required because static HTML alone cannot securely hold OAuth refresh state, perform reliable background scans, protect connector credentials, enforce tool policies, or manage a local database.

**Approved 12 September 2026:** TypeScript on Node.js shall be used for the local service and browser code. This gives one typed language across the UI, API contracts, scheduler, MCP client, and policy layer. This technology decision does not by itself approve application development; the overall specification must still reach approved status under §18.

Python/FastAPI is not selected for release 1. Introducing Python as an application runtime later requires a specification change and user approval. Development-only utilities may not introduce Python without the same approval.

### 8.3 Storage

Use a local SQLite database for non-secret configuration, sync cursors, message references, permitted cached content, summaries, actions, and audit events. Sensitive columns containing retained message text or snippets shall be encrypted using a key stored in the OS credential store.

Recommended defaults:

- Raw message text: retain the user-approved 30 days.
- Derived summaries and actions: retain the user-approved 90 days.
- Audit metadata without message content: retain 180 days.
- Connector raw payloads: do not persist; retain normalized evidence references only.
- Deleted source messages: purge cached text at the next reconciliation, subject to a short diagnostic tombstone containing only ID/hash and deletion time.

The user shall be able to change retention, purge by space or date, and delete all local data.

### 8.4 Agentic orchestration

The orchestrator shall be an application-controlled state machine, not an unconstrained autonomous loop:

1. Validate scan scope and policy.
2. Retrieve incremental Webex messages.
3. Normalize and partition by space/thread.
4. Apply deterministic pre-filters.
5. Generate structured summary and candidate outputs against a strict schema.
6. Validate source references and confidence.
7. If needed and permitted, plan a bounded set of read-only connector queries.
8. Policy-check each proposed query before execution.
9. Generate evidence-backed recommendations.
10. Persist approved derived results and audit metadata.

Limits shall include maximum model turns, maximum tool calls, maximum retrieved characters, per-run token/cost budget, timeout, and cancellation. Exceeding a limit results in a partial result with a visible warning.

### 8.5 Action execution layer

Define a typed action-adapter interface so recommendations can describe potential operations consistently. In release 1:

- `READ` operations may be enabled per connector.
- `DRAFT` operations produce local text or plans only.
- `WRITE`, `SEND`, `DELETE`, `APPROVE`, `MERGE`, `TRANSITION`, `INVITE`, and `RUN` operations are denied by policy and unavailable in the UI.

Any future external execution requires a new approved spec version, per-action preview, explicit user confirmation at the moment of action, narrow credentials, idempotency, rollback analysis, and a complete audit record. “Auto-execute” remains prohibited.

### 8.6 Repository and maintainability

The canonical repository is `https://github.com/saransuresh1705/Action-Insights`. Application code, configuration examples, database migrations, tests, architectural decision records, and this specification shall be maintained in that repository.

The required repository conventions are:

- `docs/technical-specification.md` is the canonical specification.
- Specification changes and their corresponding implementation changes shall be traceable through commits and pull requests.
- A code change that alters product behavior, security boundaries, data handling, dependencies, deployment, or acceptance criteria shall reference an approved specification revision.
- The repository shall contain placeholder/example configuration only; credentials and machine-local configuration remain outside the repository.
- Generated artifacts, local databases, logs, message exports, model caches, credential files, and developer tokens shall be excluded through `.gitignore` and reinforced by automated secret scanning.
- Release tags shall identify the implemented specification version.
- The default branch shall remain releasable; substantive changes should use reviewed branches or pull requests once repository protections are established.

## 9. Data model (logical)

| Entity | Key fields |
|---|---|
| UserProfile | Webex person ID, display name, email hash/display policy, time zone, preferences |
| Space | room ID, title, type, team ID if present, access status, last activity |
| WatchedCollection | ID, name, description, schedule override, summary settings |
| CollectionSpace | collection ID, room ID, included state, sensitivity policy |
| SyncCursor | room ID, last successful timestamp/message ID, overlap marker, last result |
| MessageRef | message ID, room ID, parent ID, author ID, timestamps, content hash, encrypted retained text, deletion state |
| ScanRun | ID, trigger, start/end, coverage, counts, warnings, status, usage |
| SpaceSummary | ID, room ID, period, structured sections, evidence IDs, model metadata, stale state |
| ActionCandidate | ID, category, status, confidence, owner, due date, urgency, rationale, evidence IDs, stale state |
| DraftResponse | ID, action ID, tone, text, version, generated time, copied time |
| Recommendation | ID, action ID, steps, evidence links, assumptions, missing info, risk flags |
| Connector | ID, type, enabled state, read-only operations, resource allow-list, credential reference |
| AuditEvent | time, actor, event type, target reference, policy outcome, non-sensitive details |

Raw access tokens, refresh tokens, OAuth client secrets, API keys, and connector secrets are not database fields.

## 10. Configuration and credential handling

### 10.1 Non-secret local configuration

The app shall use a user-owned local YAML or JSON configuration file outside source control. A representative structure is:

```yaml
app:
  timezone: Asia/Kolkata
  data_directory: /user/selected/path
scan:
  interval_minutes: 60
  initial_backfill_days: 30
  overlap_minutes: 10
retention:
  raw_message_days: 30
  derived_insight_days: 90
webex:
  oauth_client_id: non-secret-client-id
  credential_ref: os-keychain://webex-action-insights/webex-oauth
model:
  provider: openai
  model: gpt-5.6-sol # recommendation; pending user and enterprise approval
  reasoning_effort: medium
  store: false
  credential_ref: os-keychain://webex-action-insights/model
connectors:
  jira:
    enabled: false
    mode: read-only
    credential_ref: os-keychain://webex-action-insights/jira
```

The checked-in repository may contain a `.example` file with placeholders only.

### 10.2 Secrets

**Approved 12 September 2026:** The operating-system credential-store design described in this section is the required release-1 approach.

The phrase “credentials are not stored in code” is compatible with unattended operation only if tokens are stored somewhere securely. The required design is:

- Configuration stores credential **references**, not secret values.
- Secret values are stored in the operating system credential store (for example, macOS Keychain) or another user-approved secure local secret provider.
- The service reads secrets only at the point of use and never returns them to the browser.
- Refresh-token rotation is atomic; the old token is removed after the new token is safely stored.
- Logs redact authorization headers, tokens, cookies, query credentials, and likely secret patterns.
- Secret-bearing memory is short-lived where practical.

A plaintext `secrets.yaml` option is **not recommended and not included** in the baseline specification. If the user explicitly requires it, that must be an approved spec change with file-permission, backup, and disclosure warnings.

## 11. Guardrails and safety invariants

### 11.1 No side effects

1. No write scopes shall be requested for Webex or connectors in release 1.
2. Side-effecting tool names and HTTP methods shall be blocked at registration and again at invocation.
3. The model shall never receive credentials or direct network access.
4. Connector calls shall pass through the policy engine; the model cannot call arbitrary URLs, shell commands, or code execution.
5. A policy denial is final for the current run and is visible in diagnostics.

### 11.2 High-consequence domains

The app may summarize but shall not recommend a final irreversible decision or enable execution for:

- Security incident containment, access grants, secrets, or identity changes.
- Production deployments, infrastructure changes, or destructive commands.
- Legal commitments, regulatory filings, or contract acceptance.
- HR decisions, performance actions, hiring, termination, or compensation.
- Financial transfers, purchases, expense approval, or trading.
- Customer commitments, public statements, or disclosure of confidential information.
- Deleting records, messages, repositories, tickets, pages, or files.

Such items shall receive a “High-consequence — human review required” banner and a conservative checklist.

### 11.3 Prompt-injection resistance

- Webex messages, files, links, issue text, comments, pages, and MCP responses are untrusted data, never instructions to the application.
- Retrieved content cannot change system policy, tool permissions, collection scope, or credential behavior.
- The model sees clear data boundaries and receives only minimum required context.
- Tool arguments are schema-validated and independently policy-checked.
- Requests to reveal prompts, credentials, hidden context, or unrelated spaces are ignored and logged as suspicious content.
- Cross-space and cross-connector data leakage tests are release blockers.

### 11.4 Grounding and uncertainty

- Every summary decision, action candidate, and recommendation must carry source evidence.
- Inference must be labelled as inference.
- Missing due dates, owners, completion claims, or external facts must remain missing rather than being invented.
- Low-confidence items go to Needs review.
- A visible “Report incorrect insight” action shall capture feedback locally.

### 11.5 Data protection

- Local-only bind address by default.
- Authenticated, HTTP-only, SameSite session cookie; CSRF protection on state-changing local endpoints.
- Strict Content Security Policy and output escaping.
- Encrypted retained message content and local backups only when explicitly configured.
- No telemetry containing message text, names, space titles, URLs, or connector payloads.
- Crash reports are opt-in and scrubbed.
- Message content may leave the device only for transient processing by an approved model endpoint or approved read-only connector. It shall not be persistently stored outside the device.
- Model-provider data handling, retention, region, safety-retention exceptions, and enterprise approval must be verified before model access is enabled.
- If the required zero-retention controls cannot be verified at runtime or deployment approval time, external model calls shall fail closed and local ingestion/review shall remain available without AI analysis.
- No prompt, response, model cache, trace, or raw connector payload containing message content may be written to external logs, observability systems, evaluation stores, or backups.

## 12. Non-functional requirements

### 12.1 Reliability

- A failed space or connector shall not invalidate unrelated space results.
- Cursor updates occur only after the corresponding page is durably processed.
- Re-running a scan is idempotent.
- Database migrations are transactional and backed up before change.
- Authentication expiry produces a clear reconnect state, not silent data gaps.

### 12.2 Performance targets

Targets apply to a reference workload of 100 selected spaces and 5,000 new messages/day on a contemporary laptop; they must be validated during implementation planning.

- Dashboard from local cache: p95 under 2 seconds.
- Filter/search over retained insights: p95 under 500 ms.
- First visible scan progress: under 2 seconds.
- Manual cancellation acknowledged: under 2 seconds.
- Analysis throughput: reported transparently; no hard target until the model and deployment are approved.

### 12.3 Accessibility

- Conform to WCAG 2.2 AA for keyboard operation, focus, semantics, color contrast, and screen-reader labels.
- Do not encode action category, confidence, urgency, or status by color alone.
- Copy and external-navigation controls require descriptive accessible names.

### 12.4 Observability

Local diagnostics shall include scan timing, API status codes, retry counts, space coverage, model usage, connector calls, policy denials, and software version. Message bodies, message snippets, attachment names/content, person names, email addresses, direct-space titles, space titles, URLs, connector payloads, model prompts/responses, and secrets shall never be written to diagnostic or application logs. Stable identifiers shall be locally keyed hashes when correlation is required. Logging shall use allow-listed structured fields rather than redaction as the primary protection; redaction remains a defense in depth.

### 12.5 Compatibility

- Initial target: user-approved personal, local deployment on current macOS with a current Chromium-, Safari-, or Firefox-based browser.
- Webex desktop and web-client navigation shall be tested separately.
- Other operating systems and mobile UI are out of scope until approved.

## 13. API and integration design

### 13.1 Webex ingestion

Preferred baseline: Webex REST APIs with OAuth, deterministic pagination, and scheduled polling. This aligns directly with the user's fixed-interval requirement and works for a local app without a publicly reachable webhook endpoint.

Webhooks or WebSocket events may be evaluated later as hints for freshness, but scheduled reconciliation remains the source of completeness. Webex webhook payloads omit sensitive message text and require an authenticated follow-up fetch.

The official Webex Messaging MCP server may be useful for agent-initiated, read-only lookups. It shall not replace deterministic ingestion, and its write tools/scopes shall not be enabled. Its availability also depends on organization administrator enablement.

### 13.2 Enterprise connectors

Each connector adapter exposes only normalized read operations, for example:

- Jira: find issue, read issue, read comments/status/history.
- GitHub: find/read issue, pull request, checks, review comments, files changed metadata.
- Confluence: search/read page and page metadata.
- SharePoint: search/read approved sites, pages, and file metadata/content where explicitly allowed.
- Other Cisco tools: individually specified and approved operations.

Connector output shall include source system, stable item ID, title, URL, retrieval time, and authorization scope. Connector-specific secrets and access controls remain independent.

**Approved implementation sequence:** Jira read-only is the first connector. GitHub and Confluence follow after Jira meets its acceptance criteria. SharePoint follows only after enterprise authentication and data-handling feasibility are validated. The sequence does not enable any connector write operation and may be changed only through the specification-first process.

### 13.3 Model provider

**D-05 recommendation, pending approval:** use OpenAI `gpt-5.6-sol` through the Responses API. Within the GPT-5.6 family, this is the recommended quality-first choice for the core summarization, classification, drafting, and bounded tool-planning workload. Use structured outputs and function calling through the provider adapter. Use `medium` reasoning for routine scans and allow a policy-controlled escalation to `high` for ambiguous or high-consequence analysis; the model still cannot execute an action.

`gpt-5.6-terra` is a future cost/latency optimization candidate and `gpt-5.6-luna` is a future high-volume, cost-sensitive candidate. Neither should replace the quality baseline until evaluation against the approved corpus shows that it meets the same safety and accuracy thresholds.

Before implementation, the user and relevant Cisco data-governance owner must approve:

- Provider and model.
- Hosting/region and enterprise agreement.
- Data retention and training policy.
- Maximum context and usage budget.
- The zero-retention data path specified in §13.4.
- Structured-output and tool-use capabilities.
- Redaction requirements.

The application shall use a provider adapter so the orchestration and policy layer does not depend on one model vendor.

### 13.4 External processing and zero-retention profile

**D-06 approved by the user on 12 September 2026:** message content may leave the device for transient processing, but it shall not be stored anywhere outside the device.

The OpenAI deployment profile shall therefore meet all of the following requirements before model calls are enabled:

- Use a Cisco-approved OpenAI API organization/project for which **Zero Data Retention (ZDR)** has been enabled and verified. Standard API abuse-monitoring retention, which may retain customer content for up to 30 days, does not satisfy D-06.
- Use foreground, stateless `POST /v1/responses` requests with `store: false`. Do not use `previous_response_id` or any server-side conversation state.
- Do not use Conversations, Assistants/Threads, Files, Vector Stores, Batch, background mode, hosted Code Interpreter, or another feature that persists application state or is not eligible for ZDR.
- Disable implicit prompt caching for GPT-5.6 by setting `prompt_cache_options.mode` to `explicit` and providing no cache key or cache breakpoints. Prompts and reusable context remain local.
- Do not configure OpenAI-hosted remote MCP tools. The local policy broker invokes approved read-only connectors, applies minimization/redaction, and supplies only the necessary normalized result to the model request.
- Do not opt API data into model training or feedback sharing. Do not attach message-bearing payloads to support tickets, eval services, tracing systems, or third-party telemetry.
- Treat connector services as separate external processors. A connector may receive message-derived search terms or context only after its own retention, logging, residency, classification, and enterprise approval satisfy D-06.

The service shall run a startup and preflight policy check for the configured provider profile. Missing or unverifiable ZDR entitlement, use of a prohibited endpoint/tool, or a request option that enables storage shall block the request and produce a local diagnostic without message content.

OpenAI documents limited safety or legal-retention exceptions even for approved data controls. The Cisco data-governance owner must confirm that the applicable contract and deployment configuration satisfy the user's “not stored outside the device” requirement. If that absolute requirement cannot tolerate the provider's disclosed exceptions or associated service metadata, a cloud model is not eligible and a separately specified on-device model is required.

## 14. Analysis quality contract

### 14.1 Structured output

Model outputs shall be validated against versioned JSON schemas. Invalid output is retried once with a repair instruction; a second failure produces a visible analysis error, not guessed data.

### 14.2 Evidence validation

Before an insight is shown:

- Every cited message ID must exist in the scan's permitted context.
- Quoted snippets must match normalized source content.
- A due date must be explicit in source evidence or labelled inferred.
- The proposed owner must be explicit or supported by a recorded ownership signal.
- Connector links must originate from an allow-listed connector response.

### 14.3 Evaluation set

Before release, create a user-approved, redacted evaluation corpus covering:

- Direct questions, mentions, and explicit assignments.
- Requests already answered by the user.
- Team-wide announcements with no personal action.
- Sarcasm, rhetorical questions, quoted text, pasted logs, and bot messages.
- Threaded replies, edits, deletions, and reassignment.
- Multiple actions in one message and one action across many messages.
- Prompt injection and data-exfiltration attempts.
- High-consequence requests.

Release thresholds shall be established after corpus review. At minimum, false “action needed from me” results must be measured separately from missed actions, and exact-message evidence precision must be 100% in the tested corpus.

## 15. Platform feasibility gates

These gates must be resolved before implementation scope is approved.

### P0-01 — Native Webex section discovery

**Status:** **Closed — app-local section mirroring approved by the user on 12 September 2026.**

**Finding:** Webex documents end-user space sections, but the reviewed public Rooms and Messages API references do not expose a section resource or section membership field.

**Approved release-1 design:** The user creates Watched Collections and selects spaces from the API-provided space catalog. The UI shall provide quick bulk selection and optional paste/import of Webex space links. It shall not scrape Webex UI files or automate the desktop client.

Native section discovery may be reconsidered only if Webex later exposes a supported API. Adding synchronization would require a specification revision and user approval.

### P0-02 — Exact-message deep-link compatibility

**Status:** **Feasible for the macOS Webex desktop client; public-contract risk remains.**

**Evidence as of 12 September 2026:**

- Cisco officially documents and supports the `webexteams` protocol and the space form `webexteams://im?space=<space-uuid>`.
- The installed macOS Webex application registers the `webexteams` URL scheme. Read-only inspection of installed Webex version `44.8.0.30404` found both its space URI handler and the `&message=` token in the messaging client binary.
- Independently reported links produced by Webex use `webexteams://im?space=<space-uuid>&message=<message-uuid>` and open at the corresponding message.
- The Webex Messages API supplies the source message ID and room ID needed by the adapter, but neither the API response nor Cisco's public protocol article provides a message deep-link field or documents the `message` query parameter.

**Conclusion:** UR-03 is technically feasible for the release-1 macOS desktop target. It is not an officially guaranteed Webex public API contract, so it must be implemented as the guarded compatibility adapter specified in §6.10, with the documented space link as fallback. Exact-message navigation in the Webex web client is not confirmed.

**Mandatory release test:** Validate the generated link with a non-sensitive test space and message against the user's then-current Webex desktop version. Test group and direct spaces, root and thread messages, and signed-out/deleted/no-access states. A failure disables only exact navigation, produces a clear warning, and leaves the source reference and space fallback available.

**Fallback decision:** **Closed — approved by the user on 12 September 2026.** Keep the documented space-link fallback with timestamp, author, snippet, copyable source reference, and a compatibility warning.

### P0-03 — Enterprise approval and data path

**Status:** **Partially resolved; enterprise verification remains required.**

The user approved transient off-device processing with no external persistence on 12 September 2026. The technical profile in §13.4 requires an approved zero-retention deployment and fails closed otherwise. Confirm that the chosen Webex integration, OpenAI organization/project and ZDR entitlement, local storage design, and each connector are permitted for Cisco message data and the classifications present in selected spaces. D-05 remains open until the user accepts the `gpt-5.6-sol` recommendation and the enterprise owner approves its data path.

### P0-04 — Credential design

**Status:** **Closed — approved by the user on 12 September 2026.**

OS credential storage with non-secret references in the local configuration file satisfies the credential requirement. Plaintext local credential files are excluded from the release-1 baseline. Any later introduction of plaintext credential storage requires a specification change and explicit user approval.

## 16. Testing and acceptance

### 16.1 Functional acceptance

1. User connects via read-only OAuth and can inspect granted scopes.
2. User can create collections, select spaces, set schedule/backfill, and run a scan.
3. Incremental scans do not duplicate messages, summaries, or action candidates.
4. Each selected space receives a coverage-labelled summary or an explicit error/no-activity state.
5. Action candidates contain valid source evidence, category, rationale, and confidence.
6. Reply candidates provide a copyable draft and no send capability.
7. Non-reply candidates provide ordered suggestions and evidence from any enabled connector.
8. Connector write tools cannot be registered or invoked.
9. All source links conform to the outcome of P0-02.
10. User can correct, snooze, resolve, dismiss, and delete derived items.
11. User can purge all local data and disconnect credentials.
12. Partial scans and stale insights are unmistakably labelled.

### 16.2 Security acceptance

- Repository secret scan finds no credentials.
- Browser network inspection finds no secret exposure.
- Logs and exports pass secret/PII redaction tests.
- Canary tests place unique message text, names, email addresses, direct-space titles, attachment names, URLs, prompt text, and connector content into test inputs and verify that none appears in application logs, diagnostics, telemetry, or crash-report payloads.
- Prompt-injection tests cannot change tool permissions, retrieve other spaces, or invoke writes.
- Cross-space isolation tests pass.
- Local server rejects non-loopback access by default.
- CSRF, XSS, dependency, and authorization tests pass.
- Database content cannot be decrypted without the user-bound local key.

### 16.3 Guardrail acceptance

- Attempted message send, Jira update, PR merge, page edit, file upload, calendar creation, command execution, or arbitrary HTTP request is denied.
- High-consequence examples display the required warning and conservative guidance.
- The model cannot mark an action resolved without explicit user interaction.
- The model cannot claim completion without source evidence.

## 17. Delivery phases

No phase begins until its specification and predecessor exit criteria are approved.

### Phase 0 — Feasibility and decisions

- Resolve §15 gates.
- Approve language/runtime, model/data path, credential storage, and local deployment model.
- Create redacted evaluation examples and success thresholds.

### Phase 1 — Read-only ingestion and local UI shell

- OAuth, space catalog, Watched Collections, scheduler, incremental ingestion, encrypted store, diagnostics.
- No model or connectors yet.

### Phase 2 — Summaries and action detection

- Structured model adapter, per-space summaries, taxonomy, action inbox, grounding validation, feedback.

### Phase 3 — Drafts and read-only recommendations

- Response drafts, copy flow, action planning, read-only connector broker, citations, policy denials.

### Phase 4 — Hardening and release

- Security testing, injection evaluation, accessibility, performance, packaging, backup/restore, user documentation.

Future user-confirmed external execution, if desired, is a separate post-release initiative and requires a new approved specification.

## 18. Specification and change-control policy

1. This document is the authoritative functional and safety baseline.
2. Approval must identify an exact document version or commit.
3. “Approved” means approved to implement only the scope stated in that version.
4. Every requested product change is first written into this document (or a successor specification) with affected requirements, risks, data handling, UI behavior, tests, and migration implications.
5. The change is reviewed with the user before application code is modified.
6. Code changes may begin only after the user explicitly approves the spec change.
7. Emergency security remediation may disable functionality immediately, but restoration or behavior changes still require a documented revision.
8. Implementation discoveries that contradict the spec stop affected development and create a spec issue; they are not silently worked around.
9. Each release records spec version, implementation commit, test evidence, known limitations, and user approval.

Suggested approval record:

| Version | Decision | Approved by | Date | Notes |
|---|---|---|---|---|
| 0.1-draft | Pending | — | — | Initial draft |
| 0.2-draft | Partial decision recorded | User | 12 September 2026 | D-04 approved: TypeScript on Node.js for service and browser code. UR-03 feasibility research incorporated; overall spec remains unapproved. |
| 0.3-draft | Repository decision recorded | User | 12 September 2026 | Canonical repository approved as `saransuresh1705/Action-Insights`; specification moved to `docs/technical-specification.md`. Overall spec remains unapproved. |
| 0.4-draft | Credential decision recorded | User | 12 September 2026 | P0-04 and D-14 approved: OS credential store with non-secret config references; plaintext credential files excluded. Overall spec remains unapproved. |
| 0.5-draft | Section-mirroring decision recorded | User | 12 September 2026 | P0-01 and D-01 approved: app-local Watched Collections shall mirror Webex sections. Overall spec remains unapproved. |
| 0.6-draft | Navigation, summary, and data-path decisions recorded | User | 12 September 2026 | D-02, D-03, and D-06 approved. D-05 recommendation is `gpt-5.6-sol`, pending user and enterprise approval. Overall spec remains unapproved. |
| 0.7-draft | Deployment, retention, message scope, scheduling, connector order, and attachment decisions recorded | User | 12 September 2026 | D-07 through D-12 approved. Direct messages are included with strict content-free logging. Overall spec remains unapproved. |

## 19. Open decisions for the next review

| ID | Decision | Recommended starting point |
|---|---|---|
| D-01 | Are app-local Watched Collections acceptable if Webex sections are not exposed? | **Approved by the user on 12 September 2026:** use app-local Watched Collections with easy bulk selection and collection mirroring. |
| D-02 | What is the accepted behavior if the desktop exact-message compatibility link stops working in a future Webex release? | **Approved by the user on 12 September 2026:** keep the documented space-link fallback with timestamp, author, snippet, copyable source reference, and a compatibility warning. |
| D-03 | Does “summary in a specific section” mean summaries displayed in this app for spaces in that section, or summaries posted into Webex? | **Approved by the user on 12 September 2026:** display summaries in this app; do not post them into Webex. |
| D-04 | Approve TypeScript/Node.js for the local service and browser code? | **Approved by the user on 12 September 2026.** |
| D-05 | Which model endpoint is approved for Cisco message content? | **Recommendation pending user and enterprise approval:** OpenAI `gpt-5.6-sol` through the Responses API with the §13.4 zero-retention profile. |
| D-06 | May any message content leave the device, and under what classification rules? | **Approved by the user on 12 September 2026:** transient off-device processing is permitted, but message content shall not be stored outside the device; enforce §13.4 and fail closed. |
| D-07 | Is macOS-only release 1 acceptable? | **Approved by the user on 12 September 2026:** yes, for a personal local deployment. |
| D-08 | Default initial backfill and retention? | **Approved by the user on 12 September 2026:** 30-day backfill, 30-day raw-message retention, and 90-day derived-insight retention. |
| D-09 | Include direct messages by default? | **Approved by the user on 12 September 2026:** include direct messages, while prohibiting sensitive message or identity content from logs, diagnostics, telemetry, and crash reports. |
| D-10 | Should local scans run only while the app is open, or via an installed background service? | **Approved by the user on 12 September 2026:** app-open only; a background service requires a separate installation decision and approved specification revision. |
| D-11 | Which connector should be implemented first? | **Approved by the user on 12 September 2026:** Jira read-only, then GitHub and Confluence; SharePoint after enterprise authentication feasibility. |
| D-12 | Should file attachments ever be analyzed? | **Approved by the user on 12 September 2026:** no attachment-content analysis in release 1. |
| D-13 | Which repository is canonical for specification and application code? | **Approved by the user on 12 September 2026:** `https://github.com/saransuresh1705/Action-Insights`. |
| D-14 | How shall OAuth tokens, client secrets, API keys, and connector secrets be stored? | **Approved by the user on 12 September 2026:** OS credential store; local configuration contains references only. Plaintext secret files are excluded. |

## 20. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Native Webex sections unavailable via API | Cannot automatically synchronize user-created Webex sections. | Approved app-local Watched Collections with bulk selection and optional link import; no UI scraping. |
| Exact-message desktop URI is undocumented and changes | Exact navigation may stop working after a Webex update. | Isolated validated adapter, mandatory release test, telemetry-free health warning, documented space-link fallback, no fabricated HTTPS link. |
| Large initial history and API throttling | Slow/incomplete backfill. | Bounded default backfill, pagination, resumable cursors, `Retry-After`, transparent progress. |
| False action detection | Noise or incorrect sense of obligation. | Evidence, confidence threshold, Needs review, feedback, eval corpus. |
| Missed actions | User overlooks work. | Conservative candidate recall, periodic reconciliation, measurable evaluation, no claim of completeness. |
| Prompt injection in messages or connected content | Data leakage or unsafe tool use. | Untrusted-content boundaries, allow-listed read tools, policy broker, schema validation, tests. |
| Sensitive data sent to model | Privacy/compliance issue. | Approved ZDR project, `store: false`, stateless foreground requests, caching disabled, data minimization, local redaction, prohibited persistent endpoints, and fail-closed preflight. |
| Credential theft | Unauthorized access. | OS credential store, loopback-only service, no browser exposure, redaction, rotation/revocation. |
| Cross-space leakage in summaries | Confidentiality breach. | Per-space partitions, evidence validation, isolation tests. |
| Sensitive direct-message content appears in logs | Confidentiality breach. | Content-free allow-listed structured logging, keyed identifier hashes, automated log-capture tests, and no externally transmitted diagnostics. |
| Recommendations mistaken for completed work | Miscommunication. | Explicit labels, no completion claims, no automatic resolve, no send/write capability. |

## 21. External platform findings and references

These links support the feasibility assumptions in this draft; platform behavior must be revalidated at implementation time.

- Webex states that an OAuth integration acts on a user's behalf and should request only necessary scopes: [Webex Integrations](https://developer.webex.com/admin/docs/integrations) and [Webex Authentication](https://developer.webex.com/messaging/docs/authentication).
- The Messages API applies to rooms in which the user is a member: [Webex Messages API](https://developer.webex.com/messaging/docs/api/v1/messages).
- Webex REST APIs paginate large collections and return HTTP 429 with `Retry-After`; `/messages` limits are dynamically adjusted: [Webex REST API basics and rate limiting](https://developer.webex.com/messaging/docs/basics).
- Message webhooks contain metadata and require an authenticated fetch for sensitive message text: [Webex webhooks guide](https://developer.webex.com/messaging/docs/api/guides/webhooks).
- Webex documents custom end-user space sections, including up to 50 sections and 500 spaces per section, but the reviewed public room/message references do not document a section API: [Webex App space sections](https://help.webex.com/en-us/article/uaayuo).
- Cisco documents the `webexteams` protocol and the supported space form `webexteams://im?space=<space-uuid>`: [Add links for Webex meetings or spaces with the webexteams protocol](https://help.webex.com/article/n5yzg8y).
- The exact-message form with an additional `message` UUID is corroborated by a public interoperability report but is not part of Cisco's public protocol contract; it is therefore treated as a compatibility feature: [Atlassian community report showing a Webex-generated message URI](https://community.atlassian.com/forums/Jira-questions/JIRA-Confluence-refuse-webexteams-urls/qaq-p/2885694).
- The official Webex Messaging MCP server exposes read and write tools and requires administrator enablement; release 1 would allow-list read tools only: [Webex Messaging MCP Server](https://developer.webex.com/mcp/docs/messaging-mcp-server).
- MCP guidance recommends PKCE and secure local token storage for local clients: [Model Context Protocol authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization).
- OpenAI describes `gpt-5.6-sol` as its flagship GPT-5.6 model for complex professional work and documents its structured-output and function-calling support: [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
- OpenAI documents default abuse-monitoring retention, Zero Data Retention eligibility and limitations, endpoint persistence behavior, and data-sharing controls: [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).
- The Responses API reference documents `store`, foreground/background operation, and GPT-5.6 prompt-cache options: [Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

## 22. Definition of spec-ready

The specification is ready for implementation approval only when:

- All P0 feasibility gates have recorded outcomes.
- D-01 through D-12 are answered.
- The selected model and data path are enterprise-approved.
- The approved TypeScript/Node.js runtime decision is recorded, and the credential design is approved.
- The canonical repository contains the specification at `docs/technical-specification.md`.
- Release-1 acceptance thresholds and a redacted evaluation corpus are agreed.
- The approval table identifies a final version and approver.

Until then, this document remains a refinement artifact and no application development is authorized.
