import {
  escapeMarkdown,
  SessionRecord,
  SessionTitleSource,
} from "./session-model";
import { SessionResponseState } from "./session-index";
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
  readonly icon: string;
  readonly iconColor?: string;
  readonly stateLabel?: string;
}

export function buildSessionTreeRows(
  records: readonly SessionRecord[],
  locale: string,
  t: Translate,
  now = Date.now(),
): SessionTreeRow[] {
  return records.map((record) => {
    const savedLabel = formatAbsoluteTime(record.modifiedAt, locale);
    const stateLabel = responseStateLabel(
      record.metadata?.lastResponseState,
      t,
    );
    const baseTooltip = t(
      "{0}\n\nSession ID: `{1}`\n\nLast saved: {2}\n\nTitle source: {3}",
      escapeMarkdown(record.displayTitle),
      record.id,
      savedLabel,
      titleSourceLabel(record.titleSource, t),
    );
    return {
      id: record.id,
      label: record.displayTitle,
      description: `${shortenSessionId(record.id)} · ${formatRelativeTime(record.modifiedAt, now, locale)}`,
      tooltip: stateLabel
        ? `${baseTooltip}\n\n${t("Response state: {0}", stateLabel)}`
        : baseTooltip,
      savedLabel,
      sourceLabel: titleSourceLabel(record.titleSource, t),
      hasAlias: Boolean(record.alias),
      ...responseStateIcon(record.metadata?.lastResponseState),
      ...(stateLabel ? { stateLabel } : {}),
    };
  });
}

/** Only non-complete states get a distinct icon so the common case stays quiet. */
function responseStateIcon(state: SessionResponseState | undefined): {
  icon: string;
  iconColor?: string;
} {
  switch (state) {
    case "failed":
      return { icon: "error", iconColor: "list.errorForeground" };
    case "needsInput":
      return { icon: "question", iconColor: "list.warningForeground" };
    case "cancelled":
      return { icon: "circle-slash" };
    case "pending":
      return { icon: "sync" };
    default:
      return { icon: "comment-discussion" };
  }
}

export function responseStateLabel(
  state: SessionResponseState | undefined,
  t: Translate,
): string | undefined {
  switch (state) {
    case "pending":
      return t("Pending");
    case "complete":
      return t("Complete");
    case "cancelled":
      return t("Cancelled");
    case "failed":
      return t("Failed");
    case "needsInput":
      return t("Needs input");
    case undefined:
      return undefined;
  }
}

// Constructing an Intl formatter per row dominated tree rendering, so cache by locale.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatRelativeTime(
  timestamp: number,
  now: number,
  locale: string,
): string {
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, formatter);
  }
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
  let formatter = absoluteFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    absoluteFormatters.set(locale, formatter);
  }
  return formatter.format(timestamp);
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
