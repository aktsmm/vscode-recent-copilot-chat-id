# AI Credits Runtime Contract

Date: 2026-08-06, revised 2026-08-12
Status: the credits contract shipped in 0.2.2; the Inspector-open opt-in and the index measurements below shipped in 0.3.0

## Decision

Per-session AI Credits match VS Code's `sessionCost` behavior: use the greater of the summed request-level `copilotCredits` and the maximum cumulative `sessionCopilotCredits`. If neither field is reported, the Inspector displays `Not reported`. Credits are never estimated from tokens.

Token usage prefers per-request `modelTotals` when available. Normal Chat sessions currently persist `promptTokens` and `completionTokens` without `modelTotals`; those values are aggregated as model-unattributed input/output tokens. A request is never counted through both representations.

## Official storage contract

VS Code persists chat sessions with `ObjectMutationLog` entries:

- `kind: 0`: initial complete snapshot in `v`
- `kind: 1`: set the value at path `k`
- `kind: 2`: push values `v` to an array and optionally truncate from index `i`
- `kind: 3`: delete the property at path `k`

`ChatSessionOperationLog` persists request-level `copilotCredits`, `modelTotals`, and `sessionCopilotCredits`. These fields can be updated after the initial snapshot, so reading only the first JSONL line is not sufficient. Legacy flat `.json` sessions use the same whitelisted summary contract.

Sources:

- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/objectMutationLog.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionOperationLog.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatModel.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/chatService/chatService.ts
- https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/manage-and-track-spending/monitor-ai-usage

## Runtime controls

- `agShowSessionId.readUsage` is machine-scoped and defaults to `false`.
- The extension prompts with an explicit disclosure before first use.
- Analysis starts only from the selected session row's **Analyze AI Credits** action, or when the Session Inspector opens while the machine-scoped, default-off `agShowSessionId.analyzeUsageOnInspectorOpen` is enabled together with `readUsage`.
- Opening the Inspector performs no session-file read when the opt-in is off; it renders the in-memory summary, if any, and otherwise reports `Not analyzed`.
- An Inspector-initiated read is cancelled when the panel closes, when another session is opened, and when either setting is turned off. Cancellation never clears the shared usage cache.
- Only `<selected UUID>.jsonl` or its legacy `.json` counterpart is considered.
- The current `.jsonl` format is always preferred over its legacy `.json` sibling, regardless of modification time. Malformed or unsupported JSONL can fall back to the legacy snapshot, but identity mismatches and file-change checks fail closed.
- The filename UUID must match the serialized session ID.
- File size is checked before reading and again by the parser.
- JSONL entries are replayed with a sequential line iterator rather than materializing an array of every line.
- File type, modification time, and size are rechecked after reading; symlinks are rejected before and after the read.
- Parsing runs in a local worker thread after the bounded file read. The source bytes are transferred when possible instead of synchronously copied.
- Cancellation or opt-out terminates active workers before they can populate the cache or UI.
- Cache entries are memory-only and keyed by session directory, session ID, format, mtime, and size.
- Disabling the setting increments the reader generation, cancels in-flight results, clears the cache, and closes the open Inspector before any result can be redisplayed.
- No telemetry or network access is used.

## Retained output whitelist

- session ID
- request count
- backend-reported AI Credits using VS Code session-cost semantics
- aggregated per-model input, cached, and output tokens when reported
- aggregated model-unattributed input and output tokens otherwise
- source modification time

Prompts, responses, references, titles, working directories, paths, and tool payloads may exist in the selected source file but are not returned by the parser, displayed, logged, persisted, or cached.

## Index edit statistics availability

The Inspector's changed-file and changed-line rows read `stats` from VS Code's `chat.ChatSessionStore.index`, and that field is usually absent.

- `IChatSessionEntryMetadata.stats` is optional. Only the async `getSessionMetadata()` path assigns it, from `awaitStatsForSession()`.
- `awaitStatsForSession()` returns `undefined` when the model has no live `editingSession`, and also when the accumulated diff has no files or zero added and removed lines.
- `updateAndFlushIndexSync()` rebuilds entries with `getSessionMetadataSync()`, which never sets `stats`, so a synchronous shutdown flush drops previously stored values.
- Measured 2026-08-12 on one Windows profile: 116 of 2,576 index entries across 148 workspace state databases carried `stats` (4.5%). A 17 MB session whose JSONL contained 341 `textEditGroup` occurrences still had none.

The extension therefore reports `Not recorded by VS Code for this saved session` instead of a generic unavailable value, and does not reconstruct edit counts from session files. Edit operations recorded in a JSONL are not equivalent to VS Code's final editing-session diff, and parsing them would widen the usage-analysis output whitelist below.

- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/chat.ts

## Limits

- 64 MiB UTF-8 input
- 2,000 log entries
- 1,000 requests
- 100 model totals
- 16 path segments
- finite, non-negative credit values
- non-negative safe-integer token values

## Verification contract

Tests cover initial snapshot replay, request push/truncate, nested set, delete, flat JSON, JSONL precedence and legacy fallback, sequential line replay, request/session credit reconciliation, zero versus unreported credits, model and model-unattributed token aggregation, output whitelisting, malformed input, unsupported schema, ID mismatch, dangerous paths, deleted requests, duplicate models, worker cancellation/termination/protocol validation, cache invalidation, missing files, post-read symlink rejection, and package exclusion of tests/fixtures.

Transcript preview remains a separate privacy decision and cannot reuse usage-analysis consent.
