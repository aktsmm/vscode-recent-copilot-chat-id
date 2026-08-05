import { SessionRecord, SessionTitleSource } from "./session-model";
import { shortenSessionId } from "./session-scanner";
import { Translate } from "./status-presentation";

export interface SessionTreeRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tooltip: string;
  readonly savedLabel: string;
  readonly sourceLabel: string;
  readonly hasAlias: boolean;
}

export function buildSessionTreeRows(
  records: readonly SessionRecord[],
  locale: string,
  t: Translate,
  now = Date.now(),
): SessionTreeRow[] {
  return records.map((record) => ({
    id: record.id,
    label: record.displayTitle,
    description: `${shortenSessionId(record.id)} · ${formatRelativeTime(record.modifiedAt, now, locale)}`,
    tooltip: t(
      "{0}\n\nSession ID: `{1}`\n\nLast saved: {2}\n\nTitle source: {3}",
      record.displayTitle,
      record.id,
      formatAbsoluteTime(record.modifiedAt, locale),
      titleSourceLabel(record.titleSource, t),
    ),
    savedLabel: formatAbsoluteTime(record.modifiedAt, locale),
    sourceLabel: titleSourceLabel(record.titleSource, t),
    hasAlias: Boolean(record.alias),
  }));
}

export function formatRelativeTime(
  timestamp: number,
  now: number,
  locale: string,
): string {
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60) {
    return formatter.format(deltaSeconds, "second");
  }
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) {
    return formatter.format(deltaHours, "hour");
  }
  return formatter.format(Math.round(deltaHours / 24), "day");
}

export function formatAbsoluteTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function titleSourceLabel(source: SessionTitleSource, t: Translate): string {
  switch (source) {
    case "alias":
      return t("Local title");
    case "metadata":
      return t("VS Code metadata");
    case "id":
      return t("Session ID");
  }
}
