import { SessionRecord, SessionTitleSource } from "./session-model";
import { SessionResponseState } from "./session-index";
import { formatAbsoluteTime } from "./session-tree-model";
import { Translate } from "./status-presentation";
import { SessionUsageSummary } from "./session-usage-log";

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
  | { readonly kind: "error" };

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
      value: formatOptionalTime(timing?.lastRequestStarted, locale, unavailable),
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
        responseStateLabel(record.metadata?.lastResponseState, t) ?? unavailable,
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

  if (usage?.kind === "error") {
    fields.push({ label: t("AI Credits"), value: unavailable });
  } else if (usage?.kind === "ok") {
    const numberFormatter = new Intl.NumberFormat(locale);
    fields.push(
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
        label: t("Model token usage"),
        value:
          usage.summary.models.length === 0
            ? t("Not reported")
            : usage.summary.models
                .map((model) =>
                  t(
                    "{0}: input {1}, cached {2}, output {3}",
                    model.model,
                    numberFormatter.format(model.inputTokens),
                    numberFormatter.format(model.cachedTokens),
                    numberFormatter.format(model.outputTokens),
                  ),
                )
                .join("\n"),
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
