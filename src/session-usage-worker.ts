import { parentPort } from "node:worker_threads";
import { normalizeSessionUsageErrorName } from "./session-usage-error";
import {
  analyzeSessionUsageLog,
  analyzeSessionUsageSnapshot,
  SessionUsageSummary,
} from "./session-usage-log";

interface UsageWorkerRequest {
  readonly bytes: Uint8Array;
  readonly format: "json" | "jsonl";
  readonly sessionId: string;
}

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UsageWorkerResult =
  | { readonly kind: "ok"; readonly summary: SessionUsageSummary }
  | { readonly kind: "error"; readonly errorCode: string };

if (!parentPort) {
  throw new Error("SessionUsageWorkerMissingParent");
}
const port = parentPort;

port.once("message", (value: unknown) => {
  if (!isWorkerRequest(value)) {
    port.postMessage({
      kind: "error",
      errorCode: "SessionUsageReadFailed",
    } satisfies UsageWorkerResult);
    return;
  }
  const request = value;
  let result: UsageWorkerResult;
  try {
    const content = Buffer.from(
      request.bytes.buffer,
      request.bytes.byteOffset,
      request.bytes.byteLength,
    ).toString("utf8");
    result = {
      kind: "ok",
      summary:
        request.format === "jsonl"
          ? analyzeSessionUsageLog(content, request.sessionId)
          : analyzeSessionUsageSnapshot(content, request.sessionId),
    };
  } catch (error) {
    result = {
      kind: "error",
      errorCode: normalizeSessionUsageErrorName(
        error instanceof Error ? error.name : "",
      ),
    };
  }
  port.postMessage(result);
});

function isWorkerRequest(value: unknown): value is UsageWorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const request = value as Partial<UsageWorkerRequest>;
  return (
    request.bytes instanceof Uint8Array &&
    (request.format === "json" || request.format === "jsonl") &&
    typeof request.sessionId === "string" &&
    SESSION_ID_PATTERN.test(request.sessionId)
  );
}
