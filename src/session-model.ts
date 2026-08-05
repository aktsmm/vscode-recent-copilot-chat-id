import { SavedSession, shortenSessionId } from "./session-scanner";
import { SessionIndexMetadata } from "./session-index";

export const MAX_SESSION_ALIAS_LENGTH = 120;
export const MAX_SESSION_DISPLAY_TITLE_LENGTH = 120;

export type SessionTitleSource = "alias" | "metadata" | "id";

export interface SessionRecord extends SavedSession {
  readonly displayTitle: string;
  readonly metadataTitle?: string;
  readonly alias?: string;
  readonly titleSource: SessionTitleSource;
}

export function normalizeSessionAlias(value: string): string | undefined {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > MAX_SESSION_ALIAS_LENGTH) {
    throw new Error("SessionAliasTooLong");
  }
  return normalized;
}

export function buildSessionRecords(
  sessions: readonly SavedSession[],
  index: ReadonlyMap<string, SessionIndexMetadata>,
  aliases: Readonly<Record<string, string>>,
): SessionRecord[] {
  return sessions.map((session) => {
    const alias = normalizeStoredAlias(aliases[session.id]);
    const metadataTitle = normalizeMetadataTitle(index.get(session.id)?.title);
    const displayTitle =
      alias ??
      (metadataTitle
        ? truncateTitle(metadataTitle, MAX_SESSION_DISPLAY_TITLE_LENGTH)
        : undefined) ??
      `Session ${shortenSessionId(session.id)}`;
    const titleSource: SessionTitleSource = alias
      ? "alias"
      : metadataTitle
        ? "metadata"
        : "id";

    return {
      ...session,
      displayTitle,
      metadataTitle,
      alias,
      titleSource,
    };
  });
}

export function truncateStatusTitle(title: string, maxLength = 40): string {
  return truncateTitle(title, maxLength);
}

export function selectSessionRecord(
  records: readonly SessionRecord[],
  requestedId?: string,
): SessionRecord | undefined {
  return requestedId === undefined
    ? records[0]
    : records.find((record) => record.id === requestedId);
}

function truncateTitle(title: string, maxLength: number): string {
  return title.length <= maxLength
    ? title
    : `${title.slice(0, maxLength - 1)}…`;
}

function normalizeMetadataTitle(value: string | undefined): string | undefined {
  const normalized = value?.trim().replaceAll(/\s+/g, " ");
  return normalized || undefined;
}

function normalizeStoredAlias(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized && normalized.length <= MAX_SESSION_ALIAS_LENGTH
    ? normalized
    : undefined;
}
