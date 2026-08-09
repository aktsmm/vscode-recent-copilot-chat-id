import { SessionUsageErrorCode } from "./session-usage-error";

export const MAX_SESSION_USAGE_LOG_BYTES = 64 * 1024 * 1024;
export const MAX_SESSION_USAGE_LOG_ENTRIES = 2_000;
export const MAX_SESSION_USAGE_REQUESTS = 1_000;
export const MAX_SESSION_USAGE_MODELS = 100;
export const MAX_SESSION_USAGE_MODEL_NAME_LENGTH = 200;
export const MAX_SESSION_USAGE_PATH_SEGMENTS = 16;

export interface SessionUsageModelTotal {
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

export interface SessionUsageSummary {
  readonly sessionId: string;
  readonly requestCount: number;
  readonly aiCredits?: number;
  readonly models: readonly SessionUsageModelTotal[];
  readonly unattributedTokens?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

interface RequestUsage {
  copilotCredits?: number;
  sessionCopilotCredits?: number;
  promptTokens?: number;
  completionTokens?: number;
  modelTotals?: readonly SessionUsageModelTotal[];
}

interface UsageState {
  sessionId: string;
  requests: Array<RequestUsage | undefined>;
}

interface LogEntry {
  readonly kind: number;
  readonly k?: readonly (string | number)[];
  readonly v?: unknown;
  readonly i?: number;
}

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function analyzeSessionUsageSnapshot(
  content: string,
  expectedSessionId?: string,
): SessionUsageSummary {
  if (Buffer.byteLength(content, "utf8") > MAX_SESSION_USAGE_LOG_BYTES) {
    fail("SessionUsageLogTooLarge");
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    fail("SessionUsageMalformedJson");
  }
  return summarize(parseInitial(value, expectedSessionId));
}
export function analyzeSessionUsageLog(
  content: string,
  expectedSessionId?: string,
): SessionUsageSummary {
  if (Buffer.byteLength(content, "utf8") > MAX_SESSION_USAGE_LOG_BYTES) {
    fail("SessionUsageLogTooLarge");
  }

  let state: UsageState | undefined;
  let entryCount = 0;
  for (const rawLine of iterateLines(content)) {
    if (!rawLine.trim()) {
      continue;
    }
    entryCount++;
    if (entryCount > MAX_SESSION_USAGE_LOG_ENTRIES) {
      fail("SessionUsageTooManyEntries");
    }

    const entry = parseEntry(rawLine);
    if (entryCount === 1) {
      if (entry.kind !== 0) {
        fail("SessionUsageMissingInitialEntry");
      }
      state = parseInitial(entry.v, expectedSessionId);
      continue;
    }
    if (entry.kind === 0) {
      fail("SessionUsageUnexpectedInitialEntry");
    }
    if (!state) {
      fail("SessionUsageMissingInitialEntry");
    }

    switch (entry.kind) {
      case 1:
        applySet(state, parsePath(entry.k), entry.v, expectedSessionId);
        break;
      case 2:
        applyPush(state, parsePath(entry.k), entry.v, entry.i);
        break;
      case 3:
        applyDelete(state, parsePath(entry.k));
        break;
      default:
        fail("SessionUsageUnknownEntryKind");
    }
  }

  if (!state || entryCount === 0) {
    fail("SessionUsageEmptyLog");
  }
  return summarize(state);
}

function* iterateLines(content: string): Generator<string> {
  let start = 0;
  while (start <= content.length) {
    const newline = content.indexOf("\n", start);
    const end = newline === -1 ? content.length : newline;
    const line = content.slice(start, end);
    yield line.endsWith("\r") ? line.slice(0, -1) : line;
    if (newline === -1) {
      return;
    }
    start = newline + 1;
  }
}

function parseEntry(rawLine: string): LogEntry {
  let value: unknown;
  try {
    value = JSON.parse(rawLine);
  } catch {
    fail("SessionUsageMalformedJson");
  }
  if (!isRecord(value) || !Number.isInteger(value.kind)) {
    fail("SessionUsageInvalidEntry");
  }
  return value as unknown as LogEntry;
}

function parseInitial(value: unknown, expectedSessionId?: string): UsageState {
  if (!isRecord(value) || value.version !== 3) {
    fail("SessionUsageUnsupportedSchema");
  }
  const sessionId = parseSessionId(value.sessionId, expectedSessionId);
  if (!Array.isArray(value.requests)) {
    fail("SessionUsageInvalidRequests");
  }
  if (value.requests.length > MAX_SESSION_USAGE_REQUESTS) {
    fail("SessionUsageTooManyRequests");
  }
  return {
    sessionId,
    requests: value.requests.map(parseRequestUsage),
  };
}

function applySet(
  state: UsageState,
  path: readonly (string | number)[],
  value: unknown,
  expectedSessionId?: string,
): void {
  if (path.length === 0) {
    fail("SessionUsageInvalidPath");
  }
  if (path[0] === "version") {
    if (value !== 3) {
      fail("SessionUsageUnsupportedSchema");
    }
    return;
  }
  if (path[0] === "sessionId") {
    state.sessionId = parseSessionId(value, expectedSessionId);
    return;
  }
  if (path[0] !== "requests") {
    return;
  }
  if (path.length === 1) {
    if (!Array.isArray(value) || value.length > MAX_SESSION_USAGE_REQUESTS) {
      fail("SessionUsageInvalidRequests");
    }
    state.requests = value.map(parseRequestUsage);
    return;
  }

  const requestIndex = parseRequestIndex(path[1], state.requests.length);
  if (path.length === 2) {
    state.requests[requestIndex] = parseRequestUsage(value);
    return;
  }
  if (!isUsageField(path[2])) {
    return;
  }
  if (path.length !== 3) {
    fail("SessionUsageInvalidPath");
  }
  const request = state.requests[requestIndex];
  if (!request) {
    fail("SessionUsageMissingRequest");
  }
  switch (path[2]) {
    case "copilotCredits":
      request.copilotCredits = parseCredits(value);
      break;
    case "sessionCopilotCredits":
      request.sessionCopilotCredits = parseCredits(value);
      break;
    case "promptTokens":
      request.promptTokens = parseTokenCount(value);
      break;
    case "completionTokens":
      request.completionTokens = parseTokenCount(value);
      break;
    case "modelTotals":
      request.modelTotals = parseModelTotals(value);
      break;
  }
}

function applyPush(
  state: UsageState,
  path: readonly (string | number)[],
  value: unknown,
  startIndex: number | undefined,
): void {
  if (startIndex !== undefined && !isCount(startIndex)) {
    fail("SessionUsageInvalidPushIndex");
  }
  if (value !== undefined && !Array.isArray(value)) {
    fail("SessionUsageInvalidPushValues");
  }
  if (path.length !== 1 || path[0] !== "requests") {
    return;
  }
  if (startIndex !== undefined) {
    if (startIndex > state.requests.length) {
      fail("SessionUsageInvalidPushIndex");
    }
    state.requests.length = startIndex;
  }
  if (Array.isArray(value)) {
    state.requests.push(...value.map(parseRequestUsage));
  }
  if (state.requests.length > MAX_SESSION_USAGE_REQUESTS) {
    fail("SessionUsageTooManyRequests");
  }
}

function applyDelete(
  state: UsageState,
  path: readonly (string | number)[],
): void {
  if (path.length === 0 || path[0] === "sessionId" || path[0] === "version") {
    fail("SessionUsageInvalidPath");
  }
  if (path[0] !== "requests" || path.length < 2) {
    return;
  }
  const requestIndex = parseRequestIndex(path[1], state.requests.length);
  if (path.length === 2) {
    state.requests[requestIndex] = undefined;
    return;
  }
  if (!isUsageField(path[2])) {
    return;
  }
  if (path.length !== 3) {
    fail("SessionUsageInvalidPath");
  }
  const request = state.requests[requestIndex];
  if (!request) {
    fail("SessionUsageMissingRequest");
  }
  switch (path[2]) {
    case "copilotCredits":
      delete request.copilotCredits;
      break;
    case "sessionCopilotCredits":
      delete request.sessionCopilotCredits;
      break;
    case "promptTokens":
      delete request.promptTokens;
      break;
    case "completionTokens":
      delete request.completionTokens;
      break;
    case "modelTotals":
      delete request.modelTotals;
      break;
  }
}

function parseRequestUsage(value: unknown): RequestUsage {
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    !value.requestId ||
    value.requestId.length > 200
  ) {
    fail("SessionUsageInvalidRequest");
  }
  return {
    ...(value.copilotCredits === undefined
      ? {}
      : { copilotCredits: parseCredits(value.copilotCredits) }),
    ...(value.sessionCopilotCredits === undefined
      ? {}
      : { sessionCopilotCredits: parseCredits(value.sessionCopilotCredits) }),
    ...(value.promptTokens === undefined
      ? {}
      : { promptTokens: parseTokenCount(value.promptTokens) }),
    ...(value.completionTokens === undefined
      ? {}
      : { completionTokens: parseTokenCount(value.completionTokens) }),
    ...(value.modelTotals === undefined
      ? {}
      : { modelTotals: parseModelTotals(value.modelTotals) }),
  };
}

function parseCredits(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("SessionUsageInvalidCredits");
  }
  return value;
}

function parseTokenCount(value: unknown): number {
  if (!isCount(value)) {
    fail("SessionUsageInvalidTokenCount");
  }
  return value;
}

function parseModelTotals(value: unknown): readonly SessionUsageModelTotal[] {
  if (!Array.isArray(value) || value.length > MAX_SESSION_USAGE_MODELS) {
    fail("SessionUsageInvalidModelTotals");
  }
  const seenModels = new Set<string>();
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.model !== "string" ||
      !entry.model ||
      entry.model.length > MAX_SESSION_USAGE_MODEL_NAME_LENGTH ||
      !isCount(entry.inputTokens) ||
      !isCount(entry.cachedTokens) ||
      !isCount(entry.outputTokens)
    ) {
      fail("SessionUsageInvalidModelTotals");
    }
    if (seenModels.has(entry.model)) {
      fail("SessionUsageDuplicateModelTotal");
    }
    seenModels.add(entry.model);
    return {
      model: entry.model,
      inputTokens: entry.inputTokens,
      cachedTokens: entry.cachedTokens,
      outputTokens: entry.outputTokens,
    };
  });
}

function summarize(state: UsageState): SessionUsageSummary {
  let summedCopilotCredits: number | undefined;
  let sessionCopilotCredits: number | undefined;
  const totals = new Map<string, SessionUsageModelTotal>();
  let unattributedInputTokens: number | undefined;
  let unattributedOutputTokens: number | undefined;
  let requestCount = 0;
  for (const request of state.requests) {
    if (!request) {
      continue;
    }
    requestCount++;
    if (request.copilotCredits !== undefined) {
      summedCopilotCredits = safeAdd(
        summedCopilotCredits ?? 0,
        request.copilotCredits,
        "SessionUsageCreditsOverflow",
      );
    }
    if (request.sessionCopilotCredits !== undefined) {
      sessionCopilotCredits = Math.max(
        sessionCopilotCredits ?? 0,
        request.sessionCopilotCredits,
      );
    }
    for (const entry of request.modelTotals ?? []) {
      const previous = totals.get(entry.model);
      totals.set(entry.model, {
        model: entry.model,
        inputTokens: safeAdd(
          previous?.inputTokens ?? 0,
          entry.inputTokens,
          "SessionUsageTokenOverflow",
        ),
        cachedTokens: safeAdd(
          previous?.cachedTokens ?? 0,
          entry.cachedTokens,
          "SessionUsageTokenOverflow",
        ),
        outputTokens: safeAdd(
          previous?.outputTokens ?? 0,
          entry.outputTokens,
          "SessionUsageTokenOverflow",
        ),
      });
    }
    if ((request.modelTotals?.length ?? 0) === 0) {
      if (request.promptTokens !== undefined) {
        unattributedInputTokens = safeAdd(
          unattributedInputTokens ?? 0,
          request.promptTokens,
          "SessionUsageTokenOverflow",
        );
      }
      if (request.completionTokens !== undefined) {
        unattributedOutputTokens = safeAdd(
          unattributedOutputTokens ?? 0,
          request.completionTokens,
          "SessionUsageTokenOverflow",
        );
      }
    }
  }
  if (totals.size > MAX_SESSION_USAGE_MODELS) {
    fail("SessionUsageTooManyModels");
  }
  return {
    sessionId: state.sessionId,
    requestCount,
    ...(summedCopilotCredits === undefined &&
    sessionCopilotCredits === undefined
      ? {}
      : {
          aiCredits: Math.max(
            summedCopilotCredits ?? 0,
            sessionCopilotCredits ?? 0,
          ),
        }),
    models: [...totals.values()].sort((left, right) =>
      left.model.localeCompare(right.model),
    ),
    ...(unattributedInputTokens === undefined &&
    unattributedOutputTokens === undefined
      ? {}
      : {
          unattributedTokens: {
            inputTokens: unattributedInputTokens ?? 0,
            outputTokens: unattributedOutputTokens ?? 0,
          },
        }),
  };
}

function isUsageField(value: string | number): value is string {
  return (
    value === "copilotCredits" ||
    value === "sessionCopilotCredits" ||
    value === "promptTokens" ||
    value === "completionTokens" ||
    value === "modelTotals"
  );
}

function safeAdd(
  left: number,
  right: number,
  code: SessionUsageErrorCode,
): number {
  const total = left + right;
  if (
    !Number.isSafeInteger(total) &&
    Number.isInteger(left) &&
    Number.isInteger(right)
  ) {
    fail(code);
  }
  if (!Number.isFinite(total)) {
    fail(code);
  }
  return total;
}

function parsePath(value: unknown): readonly (string | number)[] {
  if (!Array.isArray(value) || value.length > MAX_SESSION_USAGE_PATH_SEGMENTS) {
    fail("SessionUsageInvalidPath");
  }
  for (const segment of value) {
    if (
      (typeof segment !== "string" && !isCount(segment)) ||
      segment === "__proto__" ||
      segment === "prototype" ||
      segment === "constructor"
    ) {
      fail("SessionUsageInvalidPath");
    }
  }
  return value as (string | number)[];
}

function parseRequestIndex(value: unknown, length: number): number {
  if (!isCount(value) || value >= length) {
    fail("SessionUsageInvalidRequestIndex");
  }
  return value;
}

function parseSessionId(value: unknown, expected?: string): string {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    fail("SessionUsageInvalidSessionId");
  }
  const normalized = value.toLowerCase();
  if (expected && normalized !== expected.toLowerCase()) {
    fail("SessionUsageSessionIdMismatch");
  }
  return normalized;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: SessionUsageErrorCode): never {
  const error = new Error(code);
  error.name = code;
  throw error;
}
