import { SessionUsageErrorCode } from "./session-usage-error";

export interface InspectorUsageSettings {
  readonly usageReadingEnabled: boolean;
  readonly analyzeOnOpenEnabled: boolean;
}

export interface InspectorUsageOutcome {
  readonly cancelled: boolean;
  readonly staleGeneration: boolean;
  readonly errorCode?: SessionUsageErrorCode;
}

/** Opening the Inspector may read a session file only while both opt-ins are on. */
export function canAnalyzeOnInspectorOpen(
  settings: InspectorUsageSettings,
  hasSessionDirectory: boolean,
): boolean {
  return (
    settings.usageReadingEnabled &&
    settings.analyzeOnOpenEnabled &&
    hasSessionDirectory
  );
}

/** Keeps cancelled, superseded, and opted-out results out of the cache and the panel. */
export function shouldApplyInspectorUsage(
  settings: InspectorUsageSettings,
  outcome: InspectorUsageOutcome,
): boolean {
  if (outcome.cancelled || outcome.staleGeneration) {
    return false;
  }
  if (!settings.usageReadingEnabled || !settings.analyzeOnOpenEnabled) {
    return false;
  }
  return outcome.errorCode !== "SessionUsageCancelled";
}
