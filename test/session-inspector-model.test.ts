import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionInspectorModel,
  describeSessionUsageError,
} from "../src/session-inspector-model";
import { SESSION_USAGE_ERROR_CODES } from "../src/session-usage-error";
import { SessionRecord } from "../src/session-model";
import { formatAbsoluteTime } from "../src/session-tree-model";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const translate = (message: string, ...args: string[]): string =>
  args.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, value),
    message,
  );

test("buildSessionInspectorModel presents bounded index metadata", () => {
  const record: SessionRecord = {
    id: SESSION_ID,
    modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
    displayTitle: "Authentication failure",
    metadataTitle: "Authentication failure",
    titleSource: "metadata",
    metadata: {
      id: SESSION_ID,
      title: "Authentication failure",
      lastMessageDate: Date.UTC(2026, 7, 6, 10, 4),
      timing: {
        created: Date.UTC(2026, 7, 6, 9, 0),
        lastRequestStarted: Date.UTC(2026, 7, 6, 10, 0),
        lastRequestEnded: Date.UTC(2026, 7, 6, 10, 4),
      },
      stats: { fileCount: 2, added: 30, removed: 4 },
      lastResponseState: "complete",
    },
  };

  const model = buildSessionInspectorModel(record, "en-US", translate);
  assert.equal(model.locale, "en-US");
  assert.equal(model.title, "Authentication failure");
  assert.deepEqual(
    model.fields.map((field) => [field.label, field.value]),
    [
      ["Session ID", SESSION_ID],
      ["Title source", "VS Code metadata"],
      ["Created", formatAbsoluteTime(Date.UTC(2026, 7, 6, 9, 0), "en-US")],
      [
        "Last request started",
        formatAbsoluteTime(Date.UTC(2026, 7, 6, 10, 0), "en-US"),
      ],
      [
        "Last request ended",
        formatAbsoluteTime(Date.UTC(2026, 7, 6, 10, 4), "en-US"),
      ],
      ["Last saved", formatAbsoluteTime(Date.UTC(2026, 7, 6, 10, 5), "en-US")],
      ["Response state", "Complete"],
      ["Changed files", "2"],
      ["Lines added", "30"],
      ["Lines removed", "4"],
      [
        "Usage analysis",
        "Not analyzed\nRun Analyze AI Credits on this session row to read usage.",
      ],
    ],
  );
});

test("buildSessionInspectorModel marks unavailable optional metadata", () => {
  const model = buildSessionInspectorModel(
    {
      id: SESSION_ID,
      modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
      displayTitle: "Session 11111111",
      titleSource: "id",
    },
    "en-US",
    translate,
  );
  assert.equal(
    model.fields.filter((field) => field.value === "Not available").length,
    4,
  );
  assert.deepEqual(
    model.fields
      .filter((field) => field.group === "Edits")
      .map((field) => [field.label, field.value]),
    [
      [
        "Changed files and lines",
        "Not recorded by VS Code for this saved session",
      ],
    ],
  );
});

test("buildSessionInspectorModel groups fields for the inspector layout", () => {
  const model = buildSessionInspectorModel(
    {
      id: SESSION_ID,
      modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
      displayTitle: "Session 11111111",
      titleSource: "id",
      metadata: {
        id: SESSION_ID,
        title: "Session 11111111",
        lastMessageDate: Date.UTC(2026, 7, 6, 10, 4),
        stats: { fileCount: 2, added: 30, removed: 4 },
      },
    },
    "en-US",
    translate,
  );
  assert.deepEqual(
    [...new Set(model.fields.map((field) => field.group))],
    ["Session", "Timing", "Edits", "Usage"],
  );
});

test("buildSessionInspectorModel reports an in-progress analysis", () => {
  const model = buildSessionInspectorModel(
    {
      id: SESSION_ID,
      modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
      displayTitle: "Session 11111111",
      titleSource: "id",
    },
    "en-US",
    translate,
    { kind: "analyzing" },
  );
  assert.equal(
    model.fields.find((field) => field.label === "Usage analysis")?.value,
    "Analyzing",
  );
  assert.equal(
    model.fields.filter((field) => field.label === "AI Credits").length,
    0,
  );
  assert.match(model.note, /selected local session file/);
});

test("buildSessionInspectorModel presents reported AI Credits and token totals", () => {
  const model = buildSessionInspectorModel(
    {
      id: SESSION_ID,
      modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
      displayTitle: "Usage session",
      titleSource: "id",
    },
    "en-US",
    translate,
    {
      kind: "ok",
      sourceModifiedAt: Date.UTC(2026, 7, 6, 10, 6),
      summary: {
        sessionId: SESSION_ID,
        requestCount: 2,
        aiCredits: 12.75,
        models: [
          {
            model: "gpt-5",
            inputTokens: 160,
            cachedTokens: 32,
            outputTokens: 17,
          },
        ],
        unattributedTokens: { inputTokens: 20, outputTokens: 4 },
      },
    },
  );
  assert.deepEqual(
    model.fields.slice(-5).map((field) => [field.label, field.value]),
    [
      ["Usage analysis", "Complete"],
      ["AI Credits", "12.75"],
      ["Requests analyzed", "2"],
      [
        "Token usage",
        "gpt-5: input 160, cached 32, output 17\nModel not reported: input 20, output 4",
      ],
      [
        "Usage source modified",
        formatAbsoluteTime(Date.UTC(2026, 7, 6, 10, 6), "en-US"),
      ],
    ],
  );
  assert.match(model.note, /selected local session file/);
});

test("buildSessionInspectorModel distinguishes unreported usage and errors", () => {
  const record: SessionRecord = {
    id: SESSION_ID,
    modifiedAt: Date.UTC(2026, 7, 6, 10, 5),
    displayTitle: "Usage session",
    titleSource: "id",
  };
  const unreported = buildSessionInspectorModel(record, "en-US", translate, {
    kind: "ok",
    sourceModifiedAt: Date.UTC(2026, 7, 6, 10, 6),
    summary: {
      sessionId: SESSION_ID,
      requestCount: 1,
      models: [],
    },
  });
  assert.equal(
    unreported.fields.find((field) => field.label === "AI Credits")?.value,
    "Not reported",
  );
  const failed = buildSessionInspectorModel(record, "en-US", translate, {
    kind: "error",
    errorCode: "SessionUsageUnsupportedSchema",
  });
  assert.equal(
    failed.fields.find((field) => field.label === "AI Credits")?.value,
    "Not available",
  );
  assert.equal(
    failed.fields.find((field) => field.label === "Usage analysis")?.value,
    "This saved session format is not supported.",
  );
});

test("describeSessionUsageError classifies every safe error code", () => {
  const cases: Array<[string, string]> = [
    [
      "SessionUsageFileNotFound",
      "The local session file is no longer available.",
    ],
    [
      "SessionUsageLogTooLarge",
      "The session file exceeds the 64 MiB analysis limit.",
    ],
    [
      "SessionUsageFileChanged",
      "The session changed during analysis. Run the analysis again.",
    ],
    [
      "SessionUsageUnsupportedSchema",
      "This saved session format is not supported.",
    ],
    ["SessionUsageInvalidSessionId", "The selected session ID is invalid."],
    [
      "SessionUsageSessionIdMismatch",
      "The session file does not match the selected session.",
    ],
    [
      "SessionUsageMalformedJson",
      "The saved session data is malformed or incomplete.",
    ],
  ];
  for (const [code, expected] of cases) {
    assert.equal(
      describeSessionUsageError(
        code as (typeof SESSION_USAGE_ERROR_CODES)[number],
        translate,
      ),
      expected,
    );
  }
  for (const code of SESSION_USAGE_ERROR_CODES) {
    const message = describeSessionUsageError(code, translate);
    assert.ok(message);
    assert.doesNotMatch(message, /SessionUsage|[A-Za-z]:\\/);
  }
});
