# AI Credits Runtime Contract

Date: 2026-08-06
Status: runtime implementation complete in unreleased source; release not published

## Decision

Per-session AI Credits use the backend-reported `sessionCopilotCredits` value. Turn-scoped `copilotCredits` values are not summed or converted from tokens. If no session total is reported, the Inspector displays `Not reported`. The parser takes the maximum backend-reported cumulative session total across requests, matching VS Code's session-cost behavior while remaining independent of request order.

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
- Analysis starts only from the selected session row's **Analyze AI Credits** action.
- Only `<selected UUID>.jsonl` or its legacy `.json` counterpart is considered.
- The filename UUID must match the serialized session ID.
- File size is checked before reading and again by the parser.
- Analysis is cancellable before and after the bounded file read.
- Cache entries are memory-only and keyed by session ID, format, mtime, and size.
- Disabling the setting increments the reader generation, cancels in-flight results, clears the cache, and closes the open Inspector before any result can be redisplayed.
- No telemetry or network access is used.

## Retained output whitelist

- session ID
- request count
- maximum backend-reported AI Credits
- aggregated per-model input, cached, and output tokens
- source modification time

Prompts, responses, references, titles, working directories, paths, and tool payloads may exist in the selected source file but are not returned by the parser, displayed, logged, persisted, or cached.

## Limits

- 16 MiB UTF-8 input
- 2,000 log entries
- 1,000 requests
- 100 model totals
- 16 path segments
- finite, non-negative credit values
- non-negative safe-integer token values

## Verification contract

Tests cover initial snapshot replay, request push/truncate, nested set, delete, flat JSON, exact session totals, zero versus unreported credits, model aggregation, output whitelisting, malformed input, unsupported schema, ID mismatch, dangerous paths, deleted requests, duplicate models, cancellation, cache invalidation, missing files, and package exclusion of tests/fixtures.

Transcript preview remains a separate privacy decision and cannot reuse usage-analysis consent.
