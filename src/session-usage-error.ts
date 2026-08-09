export const SESSION_USAGE_ERROR_CODES = [
  "SessionUsageCancelled",
  "SessionUsageCreditsOverflow",
  "SessionUsageDuplicateModelTotal",
  "SessionUsageEmptyLog",
  "SessionUsageFileChanged",
  "SessionUsageFileNotFound",
  "SessionUsageInvalidCredits",
  "SessionUsageInvalidEntry",
  "SessionUsageInvalidModelTotals",
  "SessionUsageInvalidPath",
  "SessionUsageInvalidPushIndex",
  "SessionUsageInvalidPushValues",
  "SessionUsageInvalidRequest",
  "SessionUsageInvalidRequestIndex",
  "SessionUsageInvalidRequests",
  "SessionUsageInvalidSessionId",
  "SessionUsageInvalidTokenCount",
  "SessionUsageLogTooLarge",
  "SessionUsageMalformedJson",
  "SessionUsageMissingInitialEntry",
  "SessionUsageMissingRequest",
  "SessionUsageReadFailed",
  "SessionUsageSessionIdMismatch",
  "SessionUsageTokenOverflow",
  "SessionUsageTooManyEntries",
  "SessionUsageTooManyModels",
  "SessionUsageTooManyRequests",
  "SessionUsageUnexpectedInitialEntry",
  "SessionUsageUnknownEntryKind",
  "SessionUsageUnsupportedSchema",
] as const;

export type SessionUsageErrorCode = (typeof SESSION_USAGE_ERROR_CODES)[number];

const SESSION_USAGE_ERROR_CODE_SET = new Set<string>(SESSION_USAGE_ERROR_CODES);

export function isSessionUsageErrorCode(
  value: string,
): value is SessionUsageErrorCode {
  return SESSION_USAGE_ERROR_CODE_SET.has(value);
}

export function normalizeSessionUsageErrorName(
  value: string,
): SessionUsageErrorCode {
  return isSessionUsageErrorCode(value) ? value : "SessionUsageReadFailed";
}
