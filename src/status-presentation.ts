import {
  isMostRecentAmbiguous,
  SavedSession,
  shortenSessionId,
} from "./session-scanner";
import { SessionRecord, truncateStatusTitle } from "./session-model";

export type RecentChatStatusKind =
  | "recent"
  | "ambiguous"
  | "empty"
  | "unavailable";

export interface RecentChatStatus {
  readonly kind: RecentChatStatusKind;
  readonly text: string;
  /** Screen reader label. Must stay free of codicon markup. */
  readonly ariaLabel: string;
  readonly tooltip: string;
}

/** Matches the `vscode.l10n.t` signature so the extension can pass it directly. */
export type Translate = (message: string, ...args: string[]) => string;

const RECENT_ICON = "$(comment-discussion)";
const WARNING_ICON = "$(warning)";

const passthrough: Translate = (message, ...args) =>
  args.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, value),
    message,
  );

export function describeUnavailableStatus(
  t: Translate = passthrough,
): RecentChatStatus {
  return {
    kind: "unavailable",
    text: `${WARNING_ICON} ${t("Recent Chat: unavailable")}`,
    ariaLabel: t(
      "Copilot Chat session IDs are unavailable in this window. Activate to open the log.",
    ),
    tooltip: t(
      "Local Copilot Chat session filenames are unavailable in this window.\n\nSelect to open the log.",
    ),
  };
}

export function describeSessionStatus(
  sessions: readonly SavedSession[],
  t: Translate = passthrough,
): RecentChatStatus {
  if (sessions.length === 0) {
    return {
      kind: "empty",
      text: `${RECENT_ICON} ${t("Recent Chat: none")}`,
      ariaLabel: t(
        "No saved Copilot Chat session IDs were found. Activate to review saved IDs.",
      ),
      tooltip: t(
        "No saved local Copilot Chat session filenames were found.\n\nSelect to review saved IDs.",
      ),
    };
  }

  const savedCount = describeCount(sessions.length, t);

  if (isMostRecentAmbiguous(sessions)) {
    return {
      kind: "ambiguous",
      text: `${WARNING_ICON} ${t("Recent Chat: ambiguous")}`,
      ariaLabel: t(
        "Multiple Copilot Chat sessions share the latest save time. Activate to choose an ID to copy.",
      ),
      tooltip: t(
        "Multiple saved sessions have the same latest timestamp.\n\n{0}\n\nSelect to choose an ID to copy.",
        savedCount,
      ),
    };
  }

  const recent = sessions[0];
  return {
    kind: "recent",
    text: `${RECENT_ICON} ${t("Recent Chat: {0}", shortenSessionId(recent.id))}`,
    ariaLabel: t(
      "Most recently saved Copilot Chat session {0}. Activate to copy the full ID.",
      shortenSessionId(recent.id),
    ),
    tooltip: t(
      "Most recently saved local session: `{0}`\n\nThis is not guaranteed to be the active chat session.\n\n{1}\n\nSelect to copy the full ID.",
      recent.id,
      savedCount,
    ),
  };
}

export function describeRecordStatus(
  records: readonly SessionRecord[],
  t: Translate = passthrough,
): RecentChatStatus {
  if (records.length === 0) {
    return describeSessionStatus([], t);
  }
  if (isMostRecentAmbiguous(records)) {
    const status = describeSessionStatus(records, t);
    return {
      ...status,
      ariaLabel: t(
        "Multiple Copilot Chat sessions share the latest save time. Activate to open the session list.",
      ),
      tooltip: t(
        "Multiple saved sessions have the same latest timestamp.\n\n{0}\n\nSelect to open the session list.",
        describeCount(records.length, t),
      ),
    };
  }

  const recent = records[0];
  const shortTitle = truncateStatusTitle(recent.displayTitle);
  return {
    kind: "recent",
    text: `${RECENT_ICON} ${t("Recent: {0}", shortTitle)}`,
    ariaLabel: t(
      "Most recently saved Copilot Chat session {0}. Activate to show it in the session list.",
      recent.displayTitle,
    ),
    tooltip: t(
      "{0}\n\nSession ID: `{1}`\n\nThis is not guaranteed to be the active chat session.\n\n{2}\n\nSelect to show it in the session list.",
      recent.displayTitle,
      recent.id,
      describeCount(records.length, t),
    ),
  };
}

function describeCount(total: number, t: Translate): string {
  return total === 1
    ? t("{0} saved session ID in this window.", String(total))
    : t("{0} saved session IDs in this window.", String(total));
}
