import * as vscode from "vscode";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  MAX_SESSION_USAGE_LOG_BYTES,
  MAX_SESSION_USAGE_MODELS,
  MAX_SESSION_USAGE_MODEL_NAME_LENGTH,
  SessionUsageSummary,
} from "./session-usage-log";
import {
  isSessionUsageErrorCode,
  normalizeSessionUsageErrorName,
  SessionUsageErrorCode,
} from "./session-usage-error";

export type SessionUsageReadResult =
  | {
      readonly kind: "ok";
      readonly summary: SessionUsageSummary;
      readonly sourceModifiedAt: number;
    }
  | {
      readonly kind: "error";
      readonly errorCode: SessionUsageErrorCode;
    };

interface SessionUsageCandidate {
  readonly uri: vscode.Uri;
  readonly format: "json" | "jsonl";
  readonly modifiedAt: number;
  readonly size: number;
}

interface CachedUsage {
  readonly format: "json" | "jsonl";
  readonly modifiedAt: number;
  readonly size: number;
  readonly summary: SessionUsageSummary;
}

type SessionUsageWorkerPort = Pick<
  Worker,
  "once" | "postMessage" | "terminate"
>;

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionUsageReader implements vscode.Disposable {
  private readonly cache = new Map<string, CachedUsage>();
  private readonly cancelActiveAnalyses = new Set<() => void>();
  private generation = 0;

  constructor(
    private readonly fileSystem: Pick<
      vscode.FileSystem,
      "stat" | "readFile"
    > = vscode.workspace.fs,
    private readonly createWorker: () => SessionUsageWorkerPort = () =>
      new Worker(path.join(__dirname, "session-usage-worker.js")),
  ) {}

  async read(
    sessionDirectory: vscode.Uri,
    sessionId: string,
    token: vscode.CancellationToken,
  ): Promise<SessionUsageReadResult> {
    const generation = this.generation;
    try {
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return { kind: "error", errorCode: "SessionUsageInvalidSessionId" };
      }
      if (this.isInvalidated(generation, token)) {
        return { kind: "error", errorCode: "SessionUsageCancelled" };
      }
      const candidates = await this.findCandidates(sessionDirectory, sessionId);
      if (this.isInvalidated(generation, token)) {
        return { kind: "error", errorCode: "SessionUsageCancelled" };
      }
      if (candidates.length === 0) {
        return { kind: "error", errorCode: "SessionUsageFileNotFound" };
      }
      let firstError: unknown;
      for (const candidate of candidates) {
        try {
          return await this.readCandidate(
            sessionDirectory,
            sessionId,
            candidate,
            generation,
            token,
          );
        } catch (error) {
          firstError ??= error;
          if (candidate.format !== "jsonl" || !canFallbackFromJsonl(error)) {
            throw error;
          }
        }
      }
      throw firstError;
    } catch (error) {
      return { kind: "error", errorCode: safeErrorCode(error) };
    }
  }

  clear(): void {
    this.generation++;
    for (const cancel of [...this.cancelActiveAnalyses]) {
      cancel();
    }
    this.cache.clear();
  }

  dispose(): void {
    this.clear();
  }

  private isInvalidated(
    generation: number,
    token: vscode.CancellationToken,
  ): boolean {
    return token.isCancellationRequested || generation !== this.generation;
  }

  private cacheKey(sessionDirectory: vscode.Uri, sessionId: string): string {
    return `${sessionDirectory.toString(true)}\u0000${sessionId.toLowerCase()}`;
  }

  private async readCandidate(
    sessionDirectory: vscode.Uri,
    sessionId: string,
    candidate: SessionUsageCandidate,
    generation: number,
    token: vscode.CancellationToken,
  ): Promise<SessionUsageReadResult> {
    if (candidate.size > MAX_SESSION_USAGE_LOG_BYTES) {
      throw namedError("SessionUsageLogTooLarge");
    }
    const cacheKey = this.cacheKey(sessionDirectory, sessionId);
    const cached = this.cache.get(cacheKey);
    if (
      cached?.format === candidate.format &&
      cached.modifiedAt === candidate.modifiedAt &&
      cached.size === candidate.size
    ) {
      return {
        kind: "ok",
        summary: cached.summary,
        sourceModifiedAt: cached.modifiedAt,
      };
    }

    const bytes = await this.fileSystem.readFile(candidate.uri);
    if (this.isInvalidated(generation, token)) {
      return { kind: "error", errorCode: "SessionUsageCancelled" };
    }
    if (bytes.byteLength > MAX_SESSION_USAGE_LOG_BYTES) {
      throw namedError("SessionUsageLogTooLarge");
    }
    const afterRead = await this.fileSystem.stat(candidate.uri);
    if (this.isInvalidated(generation, token)) {
      return { kind: "error", errorCode: "SessionUsageCancelled" };
    }
    if (
      (afterRead.type & vscode.FileType.File) === 0 ||
      (afterRead.type & vscode.FileType.SymbolicLink) !== 0 ||
      afterRead.mtime !== candidate.modifiedAt ||
      afterRead.size !== candidate.size
    ) {
      throw namedError("SessionUsageFileChanged");
    }
    const summary = await this.analyzeInWorker(
      candidate.format,
      bytes,
      sessionId,
      token,
    );
    if (this.isInvalidated(generation, token)) {
      return { kind: "error", errorCode: "SessionUsageCancelled" };
    }
    this.cache.set(cacheKey, {
      format: candidate.format,
      modifiedAt: candidate.modifiedAt,
      size: candidate.size,
      summary,
    });
    return {
      kind: "ok",
      summary,
      sourceModifiedAt: candidate.modifiedAt,
    };
  }

  private analyzeInWorker(
    format: "json" | "jsonl",
    bytes: Uint8Array,
    sessionId: string,
    token: vscode.CancellationToken,
  ): Promise<SessionUsageSummary> {
    const worker = this.createWorker();
    const transferredBytes = prepareTransferableBytes(bytes);
    return new Promise<SessionUsageSummary>((resolve, reject) => {
      let settled = false;
      let cancellation: vscode.Disposable | undefined;
      const finish = (complete: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        cancellation?.dispose();
        this.cancelActiveAnalyses.delete(cancel);
        void worker.terminate();
        complete();
      };
      const cancel = (): void =>
        finish(() => reject(namedError("SessionUsageCancelled")));
      this.cancelActiveAnalyses.add(cancel);
      cancellation = token.onCancellationRequested(cancel);
      worker.once("message", (result: unknown) => {
        let checkedResult:
          | { readonly kind: "ok"; readonly summary: SessionUsageSummary }
          | {
              readonly kind: "error";
              readonly errorCode: SessionUsageErrorCode;
            }
          | undefined;
        try {
          if (isWorkerResult(result, sessionId)) {
            checkedResult = result;
          }
        } catch {
          checkedResult = undefined;
        }
        if (!checkedResult) {
          finish(() => reject(namedError("SessionUsageReadFailed")));
          return;
        }
        if (checkedResult.kind === "error") {
          finish(() => reject(namedError(checkedResult.errorCode)));
          return;
        }
        finish(() => resolve(checkedResult.summary));
      });
      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", () =>
        finish(() => reject(namedError("SessionUsageReadFailed"))),
      );
      try {
        worker.postMessage({ bytes: transferredBytes, format, sessionId }, [
          transferredBytes.buffer,
        ]);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      if (token.isCancellationRequested) {
        cancel();
      }
    });
  }

  private async findCandidates(
    sessionDirectory: vscode.Uri,
    sessionId: string,
  ): Promise<SessionUsageCandidate[]> {
    const candidates: SessionUsageCandidate[] = [];
    for (const format of ["jsonl", "json"] as const) {
      const uri = vscode.Uri.joinPath(
        sessionDirectory,
        `${sessionId}.${format}`,
      );
      try {
        const stat = await this.fileSystem.stat(uri);
        if (
          (stat.type & vscode.FileType.File) !== 0 &&
          (stat.type & vscode.FileType.SymbolicLink) === 0
        ) {
          candidates.push({
            uri,
            format,
            modifiedAt: stat.mtime,
            size: stat.size,
          });
        }
      } catch (error) {
        if (!isFileNotFound(error)) {
          throw error;
        }
      }
    }
    return candidates;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}

function safeErrorCode(error: unknown): SessionUsageErrorCode {
  if (isFileNotFound(error)) {
    return "SessionUsageFileNotFound";
  }
  const name = error instanceof Error ? error.name : "UnknownError";
  return normalizeSessionUsageErrorName(name);
}

function isWorkerResult(
  value: unknown,
  expectedSessionId: string,
): value is
  | { readonly kind: "ok"; readonly summary: SessionUsageSummary }
  | { readonly kind: "error"; readonly errorCode: SessionUsageErrorCode } {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "ok") {
    return (
      hasExactOwnKeys(value, ["kind", "summary"]) &&
      "summary" in value &&
      isUsageSummary(value.summary, expectedSessionId)
    );
  }
  return (
    value.kind === "error" &&
    hasExactOwnKeys(value, ["kind", "errorCode"]) &&
    "errorCode" in value &&
    typeof value.errorCode === "string" &&
    isSessionUsageErrorCode(value.errorCode)
  );
}

function prepareTransferableBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isUsageSummary(
  value: unknown,
  expectedSessionId: string,
): value is SessionUsageSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const summary = value as Partial<SessionUsageSummary>;
  if (
    !hasAllowedOwnKeys(
      value,
      [
        "sessionId",
        "requestCount",
        "aiCredits",
        "models",
        "unattributedTokens",
      ],
      ["sessionId", "requestCount", "models"],
    ) ||
    summary.sessionId !== expectedSessionId.toLowerCase() ||
    !isSafeCount(summary.requestCount) ||
    (summary.aiCredits !== undefined &&
      (typeof summary.aiCredits !== "number" ||
        !Number.isFinite(summary.aiCredits) ||
        summary.aiCredits < 0)) ||
    !Array.isArray(summary.models) ||
    summary.models.length > MAX_SESSION_USAGE_MODELS
  ) {
    return false;
  }
  const seenModels = new Set<string>();
  for (const model of summary.models) {
    if (
      typeof model !== "object" ||
      model === null ||
      !hasExactOwnKeys(model, [
        "model",
        "inputTokens",
        "cachedTokens",
        "outputTokens",
      ]) ||
      typeof model.model !== "string" ||
      !model.model ||
      model.model.length > MAX_SESSION_USAGE_MODEL_NAME_LENGTH ||
      seenModels.has(model.model) ||
      !isSafeCount(model.inputTokens) ||
      !isSafeCount(model.cachedTokens) ||
      !isSafeCount(model.outputTokens)
    ) {
      return false;
    }
    seenModels.add(model.model);
  }
  if (summary.unattributedTokens === undefined) {
    return true;
  }
  return (
    typeof summary.unattributedTokens === "object" &&
    summary.unattributedTokens !== null &&
    hasExactOwnKeys(summary.unattributedTokens, [
      "inputTokens",
      "outputTokens",
    ]) &&
    isSafeCount(summary.unattributedTokens.inputTokens) &&
    isSafeCount(summary.unattributedTokens.outputTokens)
  );
}

function hasExactOwnKeys(
  value: object,
  expectedKeys: readonly string[],
): boolean {
  return hasAllowedOwnKeys(value, expectedKeys, expectedKeys);
}

function hasAllowedOwnKeys(
  value: object,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return (
    Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && allowed.has(key),
    ) && requiredKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function namedError(code: SessionUsageErrorCode): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function canFallbackFromJsonl(error: unknown): boolean {
  if (isFileNotFound(error)) {
    return true;
  }
  return (
    error instanceof Error &&
    [
      "SessionUsageMalformedJson",
      "SessionUsageMissingInitialEntry",
      "SessionUsageEmptyLog",
      "SessionUsageUnsupportedSchema",
    ].includes(error.name)
  );
}
