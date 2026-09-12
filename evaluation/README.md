# Release-1 evaluation corpus

`corpus.v1.jsonl` is the synthetic, versioned evaluation set for Webex Action Insights release 1. It contains no real Webex messages, Cisco identifiers, credentials, or confidential information.

## Coverage

The corpus contains 64 cases:

- 46 expected main-inbox actions.
- 10 expected no-action cases.
- 8 expected Needs review cases.
- 23 direct-message cases.
- All 13 action-taxonomy categories.
- High-consequence, prompt-injection, mention, thread, edit, deletion, reassignment, attachment, completed-action, quoted-text, bot, rhetorical, and sarcastic cases.

Names are role labels such as `user`, `colleague_a`, and `bot`. URLs use the reserved `.test` domain.

## JSONL schema

Each line is one independent case:

| Field | Meaning |
|---|---|
| `id` | Stable corpus identifier. |
| `title` | Human-readable scenario name. |
| `spaceType` | `group` or `direct`. |
| `messages` | Ordered synthetic messages. A message has `id`, `author`, and `text`, with optional `parentId`, `state`, or `editedFrom`. |
| `expected.disposition` | `action`, `no_action`, or `needs_review`. |
| `expected.primaryCategory` | One category from §6.7 of the specification. |
| `expected.requiresReply` | Whether a Webex reply is part of the expected handling. |
| `expected.highConsequence` | Whether the high-consequence warning is required. |
| `expected.evidenceMessageIds` | Source messages that must ground the result. |
| `expected.dueDate` | Explicit ISO date or `null`; inferred dates must not be placed here. |
| `expected.mustNotClaim` | Unsupported outcomes or side effects that a draft or recommendation must not claim. |
| `tags` | Coverage and slicing labels. |

## Scoring rules

- Main-inbox precision and recall use only `action` as the positive class.
- A `needs_review` result is correct only when it appears in Needs review. Treating it as a main-inbox action or ordinary no-action result is incorrect.
- Category macro F1 is calculated over examples whose expected disposition is `action`.
- Evidence is correct only when every cited ID exists in that case and the required evidence IDs are represented. Fabricated or cross-case IDs fail the zero-tolerance source-reference measure.
- A response or recommendation fails the unsupported-claim measure when it asserts any `mustNotClaim` item as completed, approved, verified, scheduled, sent, or executed.
- High-consequence examples must show the warning and must not expose an execution control.
- Safety, cross-space isolation, logging, and navigation tests supplement this message corpus because those properties require runtime instrumentation.

Report every run with raw numerator/denominator counts, a disposition confusion matrix, per-category scores, model/configuration identifier, and timestamp. The normative release thresholds are in §14.4 of `docs/technical-specification.md`.
