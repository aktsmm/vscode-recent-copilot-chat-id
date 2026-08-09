import { SessionRecord, SessionTitleSource } from "./session-model";
import { SessionResponseState } from "./session-index";
import { formatAbsoluteTime } from "./session-tree-model";
import { Translate } from "./status-presentation";
import { SessionUsageSummary } from "./session-usage-log";
import { SessionUsageErrorCode } from "./session-usage-error";

export interface SessionInspectorField {
  readonly label: string;
  readonly value: string;
}

export interface SessionInspectorModel {
  readonly locale: string;
  readonly title: string;
  readonly fields: readonly SessionInspectorField[];
  readonly note: string;
}

export type SessionInspectorUsage =
  | {
      readonly kind: "ok";
      readonly summary: SessionUsageSummary;
      readonly sourceModifiedAt: number;
    }
  | { readonly kind: "error"; readonly errorCode: SessionUsageErrorCode };

export function buildSessionInspectorModel(
  record: SessionRecord,
  locale: string,
  t: Translate,
  usage?: SessionInspectorUsage,
): SessionInspectorModel {
  const timing = record.metadata?.timing;
  const stats = record.metadata?.stats;
  const unavailable = t("Not available");
  const fields: SessionInspectorField[] = [
    { label: t("Session ID"), value: record.id },
    {
      label: t("Title source"),
      value: titleSourceLabel(record.titleSource, t),
    },
    {
      label: t("Created"),
      value: formatOptionalTime(timing?.created, locale, unavailable),
    },
    {
      label: t("Last request started"),
      value: formatOptionalTime(
        timing?.lastRequestStarted,
        locale,
        unavailable,
      ),
    },
    {
      label: t("Last request ended"),
      value: formatOptionalTime(timing?.lastRequestEnded, locale, unavailable),
    },
    {
      label: t("Last saved"),
      value: formatAbsoluteTime(record.modifiedAt, locale),
    },
    {
      label: t("Response state"),
      value:
        responseStateLabel(record.metadata?.lastResponseState, t) ??
        unavailable,
    },
    {
      label: t("Changed files"),
      value: stats ? String(stats.fileCount) : unavailable,
    },
    {
      label: t("Lines added"),
      value: stats ? String(stats.added) : unavailable,
    },
    {
      label: t("Lines removed"),
      value: stats ? String(stats.removed) : unavailable,
    },
  ];

  if (!usage) {
    fields.push({ label: t("Usage analysis"), value: t("Not analyzed") });
  } else if (usage.kind === "error") {
    fields.push(
      {
        label: t("Usage analysis"),
        value: describeSessionUsageError(usage.errorCode, t),
      },
      { label: t("AI Credits"), value: unavailable },
      { label: t("Token usage"), value: unavailable },
    );
  } else if (usage?.kind === "ok") {
    const numberFormatter = new Intl.NumberFormat(locale);
    const tokenUsage = usage.summary.models.map((model) =>
      t(
        "{0}: input {1}, cached {2}, output {3}",
        model.model,
        numberFormatter.format(model.inputTokens),
        numberFormatter.format(model.cachedTokens),
        numberFormatter.format(model.outputTokens),
      ),
    );
    if (usage.summary.unattributedTokens) {
      tokenUsage.push(
        t(
          "Model not reported: input {0}, output {1}",
          numberFormatter.format(usage.summary.unattributedTokens.inputTokens),
          numberFormatter.format(usage.summary.unattributedTokens.outputTokens),
        ),
      );
    }
    fields.push(
      { label: t("Usage analysis"), value: t("Complete") },
      {
        label: t("AI Credits"),
        value:
          usage.summary.aiCredits === undefined
            ? t("Not reported")
            : new Intl.NumberFormat(locale, {
                maximumFractionDigits: 3,
              }).format(usage.summary.aiCredits),
      },
      {
        label: t("Requests analyzed"),
        value: numberFormatter.format(usage.summary.requestCount),
      },
      {
        label: t("Token usage"),
        value:
          tokenUsage.length === 0 ? t("Not reported") : tokenUsage.join("\n"),
      },
      {
        label: t("Usage source modified"),
        value: formatAbsoluteTime(usage.sourceModifiedAt, locale),
      },
    );
  }

  const indexNote = t(
    "This inspector reads bounded metadata from VS Code's local chat index. Chat messages and JSONL content are not read.",
  );
  const usageNote = usage
    ? t(
        "AI Credits analysis reads only the selected local session file and retains only the usage summary in memory. Prompts and responses are not displayed, logged, or cached.",
      )
    : undefined;
  return {
    locale,
    title: record.displayTitle,
    fields,
    note: usageNote ? `${indexNote}\n\n${usageNote}` : indexNote,
  };
}

export function describeSessionUsageError(
  errorCode: SessionUsageErrorCode,
  t: Translate,
): string {
  switch (errorCode) {
    case "SessionUsageCancelled":
      return t("The analysis was cancelled.");
    case "SessionUsageFileNotFound":
      return t("The local session file is no longer available.");
    case "SessionUsageLogTooLarge":
      return t("The session file exceeds the 64 MiB analysis limit.");
    case "SessionUsageFileChanged":
      return t("The session changed during analysis. Run the analysis again.");
    case "SessionUsageUnsupportedSchema":
      return t("This saved session format is not supported.");
    case "SessionUsageInvalidSessionId":
      return t("The selected session ID is invalid.");
    case "SessionUsageSessionIdMismatch":
      return t("The session file does not match the selected session.");
    case "SessionUsageTooManyEntries":
    case "SessionUsageTooManyModels":
    case "SessionUsageTooManyRequests":
    case "SessionUsageCreditsOverflow":
    case "SessionUsageTokenOverflow":
      return t("The saved session exceeds a supported analysis limit.");
    case "SessionUsageDuplicateModelTotal":
    case "SessionUsageEmptyLog":
    case "SessionUsageInvalidCredits":
    case "SessionUsageInvalidEntry":
    case "SessionUsageInvalidModelTotals":
    case "SessionUsageInvalidPath":
    case "SessionUsageInvalidPushIndex":
    case "SessionUsageInvalidPushValues":
    case "SessionUsageInvalidRequest":
    case "SessionUsageInvalidRequestIndex":
    case "SessionUsageInvalidRequests":
    case "SessionUsageInvalidTokenCount":
    case "SessionUsageMalformedJson":
    case "SessionUsageMissingInitialEntry":
    case "SessionUsageMissingRequest":
    case "SessionUsageUnexpectedInitialEntry":
    case "SessionUsageUnknownEntryKind":
      return t("The saved session data is malformed or incomplete.");
    case "SessionUsageReadFailed":
    default:
      return t(
        "The saved session data could not be analyzed. Open the output log for details.",
      );
  }
}

function formatOptionalTime(
  value: number | undefined,
  locale: string,
  unavailable: string,
): string {
  return value === undefined ? unavailable : formatAbsoluteTime(value, locale);
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

function responseStateLabel(
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
