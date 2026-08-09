import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { parseSessionId } from "./session-scanner";

export const CHAT_SESSION_INDEX_KEY = "chat.ChatSessionStore.index";
export const SESSION_INDEX_DATABASE_GLOB = "state.vscdb*";
export const MAX_SESSION_INDEX_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_INDEX_ENTRIES = 1_000;
export const MAX_SESSION_METADATA_TITLE_LENGTH = 500;

export interface SessionIndexTiming {
  readonly created: number;
  readonly lastRequestStarted?: number;
  readonly lastRequestEnded?: number;
}

export interface SessionIndexStats {
  readonly fileCount: number;
  readonly added: number;
  readonly removed: number;
}

export type SessionResponseState =
  | "pending"
  | "complete"
  | "cancelled"
  | "failed"
  | "needsInput";

export interface SessionIndexMetadata {
  readonly id: string;
  readonly title: string;
  readonly lastMessageDate: number;
  readonly timing?: SessionIndexTiming;
  readonly stats?: SessionIndexStats;
  readonly lastResponseState?: SessionResponseState;
}

export interface SessionIndexReadResult {
  readonly entries: ReadonlyMap<string, SessionIndexMetadata>;
  readonly errorCode?: SessionIndexErrorCode;
}

const SESSION_INDEX_ERROR_CODES = [
  "IndexNotFound",
  "InvalidSessionIndexEntry",
  "InvalidSessionIndexIdentity",
  "InvalidSessionIndexResponseState",
  "InvalidSessionIndexStats",
  "InvalidSessionIndexTiming",
  "SessionIndexReadFailed",
  "SessionIndexTooLarge",
  "SessionMetadataTitleTooLong",
  "TooManySessionIndexEntries",
  "UnsupportedSessionIndex",
] as const;

type SessionIndexErrorCode = (typeof SESSION_INDEX_ERROR_CODES)[number];

class SessionIndexError extends Error {
  constructor(code: SessionIndexErrorCode) {
    super(code);
    this.name = code;
  }
}

export function resolveSessionIndexPath(
  workspaceStoragePath: string | undefined,
  globalStoragePath: string,
): string {
  return path.join(
    path.dirname(workspaceStoragePath ?? globalStoragePath),
    "state.vscdb",
  );
}

export function parseSessionIndex(
  value: string,
  allowedIds?: ReadonlySet<string>,
): ReadonlyMap<string, SessionIndexMetadata> {
  if (Buffer.byteLength(value, "utf8") > MAX_SESSION_INDEX_BYTES) {
    throw new SessionIndexError("SessionIndexTooLarge");
  }
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
    throw new SessionIndexError("UnsupportedSessionIndex");
  }

  const rawEntries = Object.entries(parsed.entries);
  if (rawEntries.length > MAX_SESSION_INDEX_ENTRIES) {
    throw new SessionIndexError("TooManySessionIndexEntries");
  }

  const entries = new Map<string, SessionIndexMetadata>();
  for (const [key, raw] of rawEntries) {
    const keyId = parseSessionId(`${key}.json`);
    if (!keyId || (allowedIds && !allowedIds.has(keyId))) {
      continue;
    }
    if (
      !isRecord(raw) ||
      typeof raw.sessionId !== "string" ||
      typeof raw.title !== "string" ||
      typeof raw.lastMessageDate !== "number" ||
      !Number.isFinite(raw.lastMessageDate)
    ) {
      throw new SessionIndexError("InvalidSessionIndexEntry");
    }

    if (raw.title.length > MAX_SESSION_METADATA_TITLE_LENGTH) {
      throw new SessionIndexError("SessionMetadataTitleTooLong");
    }

    const id = parseSessionId(`${raw.sessionId}.json`);
    if (!id) {
      continue;
    }
    if (key.toLowerCase() !== id || entries.has(id)) {
      throw new SessionIndexError("InvalidSessionIndexIdentity");
    }

    const timing = parseTiming(raw.timing);
    const stats = parseStats(raw.stats);
    const lastResponseState = parseResponseState(raw.lastResponseState);
    entries.set(id, {
      id,
      title: raw.title,
      lastMessageDate: raw.lastMessageDate,
      ...(timing ? { timing } : {}),
      ...(stats ? { stats } : {}),
      ...(lastResponseState ? { lastResponseState } : {}),
    });
  }
  return entries;
}

export function readSessionIndex(
  databasePath: string,
  allowedIds?: ReadonlySet<string>,
): SessionIndexReadResult {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const sizeRow = database
      .prepare(
        "SELECT length(CAST(value AS BLOB)) AS size FROM ItemTable WHERE key = ?",
      )
      .get(CHAT_SESSION_INDEX_KEY) as { size?: unknown } | undefined;
    if (typeof sizeRow?.size !== "number") {
      return { entries: new Map(), errorCode: "IndexNotFound" };
    }
    if (sizeRow.size > MAX_SESSION_INDEX_BYTES) {
      return { entries: new Map(), errorCode: "SessionIndexTooLarge" };
    }
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get(CHAT_SESSION_INDEX_KEY) as { value?: unknown } | undefined;
    if (typeof row?.value !== "string") {
      return { entries: new Map(), errorCode: "IndexNotFound" };
    }
    return { entries: parseSessionIndex(row.value, allowedIds) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      entries: new Map(),
      errorCode: SESSION_INDEX_ERROR_CODES.includes(
        name as SessionIndexErrorCode,
      )
        ? (name as SessionIndexErrorCode)
        : "SessionIndexReadFailed",
    };
  } finally {
    database?.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTiming(value: unknown): SessionIndexTiming | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isTimestamp(value.created)) {
    throw new SessionIndexError("InvalidSessionIndexTiming");
  }
  for (const field of [value.lastRequestStarted, value.lastRequestEnded]) {
    if (field !== undefined && !isTimestamp(field)) {
      throw new SessionIndexError("InvalidSessionIndexTiming");
    }
  }
  return {
    created: value.created,
    ...(typeof value.lastRequestStarted === "number"
      ? { lastRequestStarted: value.lastRequestStarted }
      : {}),
    ...(typeof value.lastRequestEnded === "number"
      ? { lastRequestEnded: value.lastRequestEnded }
      : {}),
  };
}

function parseStats(value: unknown): SessionIndexStats | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    !isCount(value.fileCount) ||
    !isCount(value.added) ||
    !isCount(value.removed)
  ) {
    throw new SessionIndexError("InvalidSessionIndexStats");
  }
  return {
    fileCount: value.fileCount,
    added: value.added,
    removed: value.removed,
  };
}

function parseResponseState(value: unknown): SessionResponseState | undefined {
  if (value === undefined) {
    return undefined;
  }
  // Persisted numeric values mirror VS Code's ResponseModelState enum.
  const states: readonly SessionResponseState[] = [
    "pending",
    "complete",
    "cancelled",
    "failed",
    "needsInput",
  ];
  if (!Number.isInteger(value) || typeof value !== "number" || !states[value]) {
    throw new SessionIndexError("InvalidSessionIndexResponseState");
  }
  return states[value];
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}
