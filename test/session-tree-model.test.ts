import assert from "node:assert/strict";
import test from "node:test";
import { SessionRecord } from "../src/session-model";
import {
  buildSessionTreeRows,
  formatRelativeTime,
} from "../src/session-tree-model";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const translate = (message: string, ...args: string[]): string =>
  args.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, value),
    message,
  );

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    modifiedAt: Date.UTC(2026, 7, 5, 10, 0),
    displayTitle: "Authentication failure",
    metadataTitle: "Authentication failure",
    titleSource: "metadata",
    ...overrides,
  };
}

test("buildSessionTreeRows exposes title, short ID, time, and source", () => {
  const [row] = buildSessionTreeRows(
    [record()],
    "en-US",
    translate,
    Date.UTC(2026, 7, 5, 10, 5),
  );

  assert.equal(row.label, "Authentication failure");
  assert.match(row.description, /^11111111 · 5 minutes ago$/);
  assert.match(row.tooltip, new RegExp(SESSION_ID));
  assert.match(row.tooltip, /VS Code metadata/);
  assert.equal(row.sourceLabel, "VS Code metadata");
  assert.equal(row.hasAlias, false);
  assert.equal(row.icon, "comment-discussion");
  assert.equal(row.iconColor, undefined);
  assert.equal(row.stateLabel, undefined);
});

test("buildSessionTreeRows neutralizes markdown in chat-derived titles", () => {
  const [row] = buildSessionTreeRows(
    [record({ displayTitle: "![x](https://example.invalid/p) **bold**" })],
    "en-US",
    translate,
    Date.UTC(2026, 7, 5, 10, 5),
  );

  assert.equal(row.label, "![x](https://example.invalid/p) **bold**");
  assert.doesNotMatch(row.tooltip, /!\[x\]\(https/);
  assert.doesNotMatch(row.tooltip, /\*\*bold\*\*/);
  assert.match(row.tooltip, /\\!\\\[x\\\]\\\(https/);
});

test("buildSessionTreeRows signals the saved response state", () => {
  const cases: [
    "pending" | "complete" | "cancelled" | "failed" | "needsInput",
    string,
    string | undefined,
    string,
  ][] = [
    ["complete", "comment-discussion", undefined, "Complete"],
    ["cancelled", "circle-slash", undefined, "Cancelled"],
    ["failed", "error", "list.errorForeground", "Failed"],
    ["needsInput", "question", "list.warningForeground", "Needs input"],
    ["pending", "sync", undefined, "Pending"],
  ];

  for (const [state, icon, iconColor, label] of cases) {
    const [row] = buildSessionTreeRows(
      [
        record({
          metadata: {
            id: SESSION_ID,
            title: "Authentication failure",
            lastMessageDate: Date.UTC(2026, 7, 5, 10, 0),
            lastResponseState: state,
          },
        }),
      ],
      "en-US",
      translate,
      Date.UTC(2026, 7, 5, 10, 5),
    );
    assert.equal(row.icon, icon, state);
    assert.equal(row.iconColor, iconColor, state);
    assert.equal(row.stateLabel, label, state);
    assert.match(row.tooltip, new RegExp(`Response state: ${label}$`), state);
  }
});

test("buildSessionTreeRows identifies aliases for context menus", () => {
  const [row] = buildSessionTreeRows(
    [
      record({
        alias: "Local title",
        displayTitle: "Local title",
        titleSource: "alias",
      }),
    ],
    "en-US",
    translate,
  );
  assert.equal(row.sourceLabel, "Local title");
  assert.equal(row.hasAlias, true);
});

test("formatRelativeTime selects compact time units", () => {
  const now = Date.UTC(2026, 7, 5, 10, 0);
  assert.equal(
    formatRelativeTime(now - 20_000, now, "en-US"),
    "20 seconds ago",
  );
  assert.equal(
    formatRelativeTime(now - 5 * 60_000, now, "en-US"),
    "5 minutes ago",
  );
  assert.equal(
    formatRelativeTime(now - 2 * 3_600_000, now, "en-US"),
    "2 hours ago",
  );
  assert.equal(
    formatRelativeTime(now - 3 * 86_400_000, now, "en-US"),
    "3 days ago",
  );
});
