import assert from "node:assert/strict";
import test from "node:test";
import { SessionRecord } from "../src/session-model";
import { buildSessionQuickPickEntries } from "../src/session-quick-pick";

const NOW = Date.UTC(2026, 7, 5, 10, 5);
const translate = (message: string, ...args: string[]): string =>
  args.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, value),
    message,
  );

function record(
  suffix: string,
  modifiedAt: number,
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  const id = `1111111${suffix}-1111-4111-8111-111111111111`;
  return {
    id,
    modifiedAt,
    displayTitle: `Session ${suffix}`,
    titleSource: "id",
    ...overrides,
  };
}

test("buildSessionQuickPickEntries exposes id, age, and the full id detail", () => {
  const [entry] = buildSessionQuickPickEntries(
    [record("1", Date.UTC(2026, 7, 5, 10, 0))],
    "en-US",
    translate,
    NOW,
  );

  assert.equal(entry.label, "Session 1");
  assert.match(
    entry.description,
    /^11111111 · 5 minutes ago · most recently saved$/,
  );
  assert.match(
    entry.detail,
    /^Session ID: 11111111-1111-4111-8111-111111111111 · Last saved /,
  );
});

test("buildSessionQuickPickEntries does not depend on the input order", () => {
  const newest = Date.UTC(2026, 7, 5, 10, 0);
  const older = Date.UTC(2026, 7, 5, 9, 0);
  const [first, second] = buildSessionQuickPickEntries(
    [record("2", older), record("1", newest)],
    "en-US",
    translate,
    NOW,
  );

  assert.doesNotMatch(first.description, /most recently saved/);
  assert.match(second.description, /most recently saved$/);
});

test("buildSessionQuickPickEntries marks a tied latest timestamp", () => {
  const tied = Date.UTC(2026, 7, 5, 10, 0);
  const entries = buildSessionQuickPickEntries(
    [record("1", tied), record("2", tied)],
    "en-US",
    translate,
    NOW,
  );

  for (const entry of entries) {
    assert.match(entry.description, /tied for most recent$/);
  }
});

test("buildSessionQuickPickEntries calls out only unusual response states", () => {
  const older = Date.UTC(2026, 7, 5, 9, 0);
  const [latest, failed, complete] = buildSessionQuickPickEntries(
    [
      record("1", Date.UTC(2026, 7, 5, 10, 0)),
      record("2", older, {
        metadata: {
          id: "11111112-1111-4111-8111-111111111111",
          title: "Session 2",
          lastMessageDate: older,
          lastResponseState: "failed",
        },
      }),
      record("3", older, {
        metadata: {
          id: "11111113-1111-4111-8111-111111111111",
          title: "Session 3",
          lastMessageDate: older,
          lastResponseState: "complete",
        },
      }),
    ],
    "en-US",
    translate,
    NOW,
  );

  assert.doesNotMatch(latest.description, /Failed|Complete/);
  assert.match(failed.description, /^11111112 · Failed · /);
  assert.doesNotMatch(complete.description, /Complete/);
});

test("buildSessionQuickPickEntries neutralizes icon syntax in titles", () => {
  const [entry] = buildSessionQuickPickEntries(
    [
      record("1", Date.UTC(2026, 7, 5, 10, 0), {
        displayTitle: "$(zap) Session",
      }),
    ],
    "en-US",
    translate,
    NOW,
  );

  assert.equal(entry.label, "(zap) Session");
});

test("buildSessionQuickPickEntries returns nothing for an empty list", () => {
  assert.deepEqual(
    buildSessionQuickPickEntries([], "en-US", translate, NOW),
    [],
  );
});
