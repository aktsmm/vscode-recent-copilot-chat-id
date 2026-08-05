import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { parseSessionId } from "./session-scanner";

export const CHAT_SESSION_INDEX_KEY = "chat.ChatSessionStore.index";
export const SESSION_INDEX_DATABASE_GLOB = "state.vscdb*";
export const MAX_SESSION_INDEX_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_INDEX_ENTRIES = 1_000;
export const MAX_SESSION_METADATA_TITLE_LENGTH = 500;

export interface SessionIndexMetadata {
  readonly id: string;
  readonly title: string;
  readonly lastMessageDate: number;
}

export interface SessionIndexReadResult {
  readonly entries: ReadonlyMap<string, SessionIndexMetadata>;
  readonly errorCode?: string;
}

class SessionIndexError extends Error {
  constructor(code: string) {
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

    entries.set(id, {
      id,
      title: raw.title,
      lastMessageDate: raw.lastMessageDate,
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
    return {
      entries: new Map(),
      errorCode: error instanceof Error ? error.name : "UnknownError",
    };
  } finally {
    database?.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
