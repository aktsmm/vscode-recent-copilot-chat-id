import * as vscode from "vscode";
import {
  analyzeSessionUsageLog,
  analyzeSessionUsageSnapshot,
  MAX_SESSION_USAGE_LOG_BYTES,
  SessionUsageSummary,
} from "./session-usage-log";

export type SessionUsageReadResult =
  | {
      readonly kind: "ok";
      readonly summary: SessionUsageSummary;
      readonly sourceModifiedAt: number;
    }
  | {
      readonly kind: "error";
      readonly errorCode: string;
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

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionUsageReader implements vscode.Disposable {
  private readonly cache = new Map<string, CachedUsage>();
  private generation = 0;

  constructor(
    private readonly fileSystem: Pick<vscode.FileSystem, "stat" | "readFile"> =
      vscode.workspace.fs,
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
      const candidate = await this.findCandidate(sessionDirectory, sessionId);
      if (this.isInvalidated(generation, token)) {
        return { kind: "error", errorCode: "SessionUsageCancelled" };
      }
      if (!candidate) {
        return { kind: "error", errorCode: "SessionUsageFileNotFound" };
      }
      if (candidate.size > MAX_SESSION_USAGE_LOG_BYTES) {
        return { kind: "error", errorCode: "SessionUsageLogTooLarge" };
      }

      const cached = this.cache.get(sessionId);
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
        return { kind: "error", errorCode: "SessionUsageLogTooLarge" };
      }
      const afterRead = await this.fileSystem.stat(candidate.uri);
      if (this.isInvalidated(generation, token)) {
        return { kind: "error", errorCode: "SessionUsageCancelled" };
      }
      if (
        afterRead.mtime !== candidate.modifiedAt ||
        afterRead.size !== candidate.size
      ) {
        return { kind: "error", errorCode: "SessionUsageFileChanged" };
      }
      const content = Buffer.from(bytes).toString("utf8");
      const summary =
        candidate.format === "jsonl"
          ? analyzeSessionUsageLog(content, sessionId)
          : analyzeSessionUsageSnapshot(content, sessionId);
      if (this.isInvalidated(generation, token)) {
        return { kind: "error", errorCode: "SessionUsageCancelled" };
      }
      this.cache.set(sessionId, {
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
    } catch (error) {
      return { kind: "error", errorCode: safeErrorCode(error) };
    }
  }

  clear(): void {
    this.generation++;
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

  private async findCandidate(
    sessionDirectory: vscode.Uri,
    sessionId: string,
  ): Promise<SessionUsageCandidate | undefined> {
    const candidates: SessionUsageCandidate[] = [];
    for (const format of ["jsonl", "json"] as const) {
      const uri = vscode.Uri.joinPath(sessionDirectory, `${sessionId}.${format}`);
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
    candidates.sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt ||
        Number(right.format === "jsonl") - Number(left.format === "jsonl"),
    );
    return candidates[0];
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

function safeErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]+$/.test(name)
    ? name
    : "SessionUsageReadFailed";
}
