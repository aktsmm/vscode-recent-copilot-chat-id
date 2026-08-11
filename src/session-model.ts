import { SavedSession, shortenSessionId } from "./session-scanner";
import { SessionIndexMetadata } from "./session-index";

export const MAX_SESSION_ALIAS_LENGTH = 120;
export const MAX_SESSION_DISPLAY_TITLE_LENGTH = 120;

export type SessionTitleSource = "alias" | "metadata" | "id";

export interface SessionRecord extends SavedSession {
  readonly displayTitle: string;
  readonly metadataTitle?: string;
  readonly metadata?: SessionIndexMetadata;
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
  t: (message: string, ...args: string[]) => string,
): SessionRecord[] {
  return sessions.map((session) => {
    const metadata = index.get(session.id);
    const alias = normalizeStoredAlias(aliases[session.id]);
    const metadataTitle = normalizeMetadataTitle(metadata?.title);
    const displayTitle =
      alias ??
      (metadataTitle
        ? truncateTitle(metadataTitle, MAX_SESSION_DISPLAY_TITLE_LENGTH)
        : undefined) ??
      t("Session {0}", shortenSessionId(session.id));
    const titleSource: SessionTitleSource = alias
      ? "alias"
      : metadataTitle
        ? "metadata"
        : "id";

    return {
      ...session,
      displayTitle,
      metadataTitle,
      metadata,
      alias,
      titleSource,
    };
  });
}

export function truncateStatusTitle(title: string, maxLength = 40): string {
  return truncateTitle(title, maxLength);
}

/** Titles come from chat content, so they must never be parsed as Markdown. */
export function escapeMarkdown(value: string): string {
  return value.replaceAll(
    /[\\`*_{}[\]()#+\-.!|<>~]/g,
    (character) => `\\${character}`,
  );
}

/** `$(name)` renders a codicon in status bar text, so neutralize it in titles. */
export function stripStatusIcons(value: string): string {
  return value.replaceAll(/\$(?=\()/g, "");
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
