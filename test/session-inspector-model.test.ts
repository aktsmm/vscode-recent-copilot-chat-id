import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionInspectorModel } from "../src/session-inspector-model";
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
    7,
  );
});

test("buildSessionInspectorModel presents reported AI Credits and model totals", () => {
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
      },
    },
  );
  assert.deepEqual(
    model.fields.slice(-4).map((field) => [field.label, field.value]),
    [
      ["AI Credits", "12.75"],
      ["Requests analyzed", "2"],
      ["Model token usage", "gpt-5: input 160, cached 32, output 17"],
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
  });
  assert.equal(
    failed.fields.find((field) => field.label === "AI Credits")?.value,
    "Not available",
  );
});
