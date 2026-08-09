import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  analyzeSessionUsageLog,
  analyzeSessionUsageSnapshot,
  MAX_SESSION_USAGE_LOG_BYTES,
  MAX_SESSION_USAGE_LOG_ENTRIES,
  MAX_SESSION_USAGE_REQUESTS,
} from "../src/session-usage-log";

const ROOT = path.resolve(__dirname, "../..");
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function initial(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 0,
    v: {
      version: 3,
      sessionId: SESSION_ID,
      creationDate: 1,
      requests: [],
      ...overrides,
    },
  });
}

function log(...entries: unknown[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

test("flat JSON snapshot uses the same exact usage contract", () => {
  const summary = analyzeSessionUsageSnapshot(
    JSON.stringify({
      version: 3,
      sessionId: SESSION_ID,
      creationDate: 1,
      requests: [
        {
          requestId: "one",
          message: "must-not-leak",
          copilotCredits: 2,
          sessionCopilotCredits: 4.5,
          modelTotals: [
            {
              model: "gpt-5",
              inputTokens: 10,
              cachedTokens: 2,
              outputTokens: 3,
            },
          ],
        },
      ],
    }),
    SESSION_ID,
  );
  assert.deepEqual(summary, {
    sessionId: SESSION_ID,
    requestCount: 1,
    aiCredits: 4.5,
    models: [
      {
        model: "gpt-5",
        inputTokens: 10,
        cachedTokens: 2,
        outputTokens: 3,
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(summary), /must-not-leak|999/);
});
test("synthetic mutation log reconstructs exact backend-reported usage", () => {
  const content = readFileSync(
    path.join(ROOT, "test", "fixtures", "session-usage-mutations.jsonl"),
    "utf8",
  );
  const summary = analyzeSessionUsageLog(content, SESSION_ID);

  assert.deepEqual(summary, {
    sessionId: SESSION_ID,
    requestCount: 2,
    aiCredits: 12.75,
    models: [
      {
        model: "claude-sonnet",
        inputTokens: 25,
        cachedTokens: 3,
        outputTokens: 8,
      },
      {
        model: "gpt-5",
        inputTokens: 160,
        cachedTokens: 32,
        outputTokens: 17,
      },
    ],
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    "aiCredits",
    "models",
    "requestCount",
    "sessionId",
  ]);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /secret|workingDirectory|prompt|response|999/,
  );
});

test("request credits are summed and zero remains a reported value", () => {
  const requestCredits = analyzeSessionUsageLog(
    `${initial({ requests: [{ requestId: "one", copilotCredits: 50 }] })}\n`,
    SESSION_ID,
  );
  assert.equal(requestCredits.aiCredits, 50);

  const unreported = analyzeSessionUsageLog(
    `${initial({ requests: [{ requestId: "one" }] })}\n`,
    SESSION_ID,
  );
  assert.equal(unreported.aiCredits, undefined);
  assert.equal(unreported.requestCount, 1);

  const zero = analyzeSessionUsageLog(
    `${initial({ requests: [{ requestId: "one", sessionCopilotCredits: 0 }] })}\n`,
    SESSION_ID,
  );
  assert.equal(zero.aiCredits, 0);
});

test("delete operations clear only whitelisted usage fields", () => {
  const summary = analyzeSessionUsageLog(
    log(
      JSON.parse(
        initial({
          requests: [
            {
              requestId: "one",
              sessionCopilotCredits: 5,
              modelTotals: [
                {
                  model: "gpt-5",
                  inputTokens: 1,
                  cachedTokens: 0,
                  outputTokens: 1,
                },
              ],
            },
          ],
        }),
      ),
      { kind: 3, k: ["requests", 0, "sessionCopilotCredits"] },
      { kind: 3, k: ["requests", 0, "modelTotals"] },
    ),
    SESSION_ID,
  );
  assert.equal(summary.aiCredits, undefined);
  assert.deepEqual(summary.models, []);
});

test("session credits use the maximum backend-reported total", () => {
  const summary = analyzeSessionUsageLog(
    `${initial({
      requests: [
        { requestId: "one", sessionCopilotCredits: 20 },
        { requestId: "two", sessionCopilotCredits: 10 },
      ],
    })}\n`,
    SESSION_ID,
  );
  assert.equal(summary.aiCredits, 20);
});

test("credits match VS Code session cost semantics", () => {
  const summary = analyzeSessionUsageLog(
    `${initial({
      requests: [
        { requestId: "one", copilotCredits: 8, sessionCopilotCredits: 10 },
        { requestId: "two", copilotCredits: 7 },
      ],
    })}\n`,
    SESSION_ID,
  );
  assert.equal(summary.aiCredits, 15);
});

test("prompt and completion tokens cover sessions without model totals", () => {
  const summary = analyzeSessionUsageLog(
    log(
      JSON.parse(
        initial({
          requests: [
            { requestId: "one", promptTokens: 100, completionTokens: 20 },
            {
              requestId: "two",
              promptTokens: 999,
              completionTokens: 999,
              modelTotals: [
                {
                  model: "gpt-5",
                  inputTokens: 50,
                  cachedTokens: 10,
                  outputTokens: 5,
                },
              ],
            },
          ],
        }),
      ),
      { kind: 1, k: ["requests", 0, "promptTokens"], v: 120 },
      { kind: 1, k: ["requests", 0, "completionTokens"], v: 25 },
    ),
    SESSION_ID,
  );
  assert.deepEqual(summary.unattributedTokens, {
    inputTokens: 120,
    outputTokens: 25,
  });
  assert.equal(summary.models[0]?.inputTokens, 50);
});

test("nested usage mutations require an existing request and exact path", () => {
  const base = JSON.parse(
    initial({ requests: [{ requestId: "one", sessionCopilotCredits: 5 }] }),
  );
  assert.throws(
    () =>
      analyzeSessionUsageLog(
        log(
          base,
          { kind: 3, k: ["requests", 0] },
          {
            kind: 1,
            k: ["requests", 0, "sessionCopilotCredits"],
            v: 10,
          },
        ),
        SESSION_ID,
      ),
    /SessionUsageMissingRequest/,
  );
  assert.throws(
    () =>
      analyzeSessionUsageLog(
        log(base, {
          kind: 1,
          k: ["requests", 0, "sessionCopilotCredits", "nested"],
          v: 10,
        }),
        SESSION_ID,
      ),
    /SessionUsageInvalidPath/,
  );
});

test("duplicate per-request model totals fail closed", () => {
  assert.throws(
    () =>
      analyzeSessionUsageLog(
        `${initial({
          requests: [
            {
              requestId: "one",
              modelTotals: [
                {
                  model: "gpt-5",
                  inputTokens: 1,
                  cachedTokens: 0,
                  outputTokens: 1,
                },
                {
                  model: "gpt-5",
                  inputTokens: 2,
                  cachedTokens: 0,
                  outputTokens: 2,
                },
              ],
            },
          ],
        })}\n`,
        SESSION_ID,
      ),
    /SessionUsageDuplicateModelTotal/,
  );
});
test("malformed, unsupported, and identity-mismatched logs fail closed", () => {
  const cases: Array<[string, string]> = [
    ["not-json\n", "SessionUsageMalformedJson"],
    [
      log({ kind: 1, k: ["requests"], v: [] }),
      "SessionUsageMissingInitialEntry",
    ],
    [`${initial({ version: 4 })}\n`, "SessionUsageUnsupportedSchema"],
    [log(JSON.parse(initial()), { kind: 4 }), "SessionUsageUnknownEntryKind"],
    [
      log(JSON.parse(initial()), {
        kind: 1,
        k: ["requests", 0, "sessionCopilotCredits"],
        v: -1,
      }),
      "SessionUsageInvalidRequestIndex",
    ],
    [
      `${initial({ sessionId: "22222222-2222-4222-8222-222222222222" })}\n`,
      "SessionUsageSessionIdMismatch",
    ],
    [
      log(JSON.parse(initial()), { kind: 1, k: ["__proto__"], v: {} }),
      "SessionUsageInvalidPath",
    ],
  ];
  for (const [content, code] of cases) {
    assert.throws(
      () => analyzeSessionUsageLog(content, SESSION_ID),
      (error: unknown) => error instanceof Error && error.name === code,
      code,
    );
  }
});

test("invalid reported usage fails closed", () => {
  for (const request of [
    { requestId: "one", sessionCopilotCredits: -1 },
    {
      requestId: "one",
      modelTotals: [
        {
          model: "gpt-5",
          inputTokens: 1,
          cachedTokens: -1,
          outputTokens: 1,
        },
      ],
    },
  ]) {
    assert.throws(() =>
      analyzeSessionUsageLog(
        `${initial({ requests: [request] })}\n`,
        SESSION_ID,
      ),
    );
  }
});

test("file, entry, and request limits fail closed", () => {
  assert.throws(
    () => analyzeSessionUsageLog("x".repeat(MAX_SESSION_USAGE_LOG_BYTES + 1)),
    /SessionUsageLogTooLarge/,
  );

  const tooManyEntries = [initial()]
    .concat(
      Array.from({ length: MAX_SESSION_USAGE_LOG_ENTRIES }, () =>
        JSON.stringify({ kind: 1, k: ["customTitle"], v: "ignored" }),
      ),
    )
    .join("\n");
  assert.throws(
    () => analyzeSessionUsageLog(tooManyEntries, SESSION_ID),
    /SessionUsageTooManyEntries/,
  );

  assert.throws(
    () =>
      analyzeSessionUsageLog(
        `${initial({ requests: Array.from({ length: MAX_SESSION_USAGE_REQUESTS + 1 }, () => ({})) })}\n`,
        SESSION_ID,
      ),
    /SessionUsageTooManyRequests/,
  );
});

test("line replay does not materialize the complete line array", () => {
  const content = `${initial()}${"\n".repeat(100_000)}`;
  const summary = analyzeSessionUsageLog(content, SESSION_ID);
  assert.equal(summary.requestCount, 0);
});
