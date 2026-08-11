import { SessionRecord, stripStatusIcons } from "./session-model";
import { shortenSessionId } from "./session-scanner";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  responseStateLabel,
} from "./session-tree-model";
import { Translate } from "./status-presentation";

export interface SessionQuickPickEntry {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
  readonly record: SessionRecord;
}

/** Shared by every command that has to pick a session without a tree node. */
export function buildSessionQuickPickEntries(
  records: readonly SessionRecord[],
  locale: string,
  t: Translate,
  now = Date.now(),
): SessionQuickPickEntry[] {
  // Derived from the values so an unsorted caller cannot mislabel the newest row.
  const latestSavedAt = Math.max(...records.map((record) => record.modifiedAt));
  const latestCount = records.filter(
    (record) => record.modifiedAt === latestSavedAt,
  ).length;
  return records.map((record) => {
    const parts = [shortenSessionId(record.id)];
    // Complete is the overwhelming majority, so only unusual states are called out.
    if (record.metadata?.lastResponseState !== "complete") {
      const stateLabel = responseStateLabel(
        record.metadata?.lastResponseState,
        t,
      );
      if (stateLabel) {
        parts.push(stateLabel);
      }
    }
    parts.push(formatRelativeTime(record.modifiedAt, now, locale));
    if (record.modifiedAt === latestSavedAt) {
      parts.push(
        latestCount > 1 ? t("tied for most recent") : t("most recently saved"),
      );
    }
    return {
      label: stripStatusIcons(record.displayTitle),
      description: parts.join(" · "),
      detail: t(
        "Session ID: {0} · Last saved {1}",
        record.id,
        formatAbsoluteTime(record.modifiedAt, locale),
      ),
      record,
    };
  });
}
