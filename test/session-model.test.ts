import assert from "node:assert/strict";
import test from "node:test";
import { SessionIndexMetadata } from "../src/session-index";
import {
  buildSessionRecords,
  MAX_SESSION_DISPLAY_TITLE_LENGTH,
  MAX_SESSION_ALIAS_LENGTH,
  normalizeSessionAlias,
  selectSessionRecord,
  truncateStatusTitle,
} from "../src/session-model";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const translate = (message: string, ...args: string[]): string =>
  args.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, value),
    message,
  );
const sessions = [{ id: SESSION_ID, modifiedAt: 500 }];
const metadata = new Map<string, SessionIndexMetadata>([
  [
    SESSION_ID,
    {
      id: SESSION_ID,
      title: "  Authentication   failure  ",
      lastMessageDate: 400,
    },
  ],
]);

test("buildSessionRecords applies alias, metadata, and ID title precedence", () => {
  const aliased = buildSessionRecords(
    sessions,
    metadata,
    {
      [SESSION_ID]: " Local investigation ",
    },
    translate,
  )[0];
  assert.equal(aliased.displayTitle, "Local investigation");
  assert.equal(aliased.titleSource, "alias");
  assert.equal(aliased.metadataTitle, "Authentication failure");

  const indexed = buildSessionRecords(sessions, metadata, {}, translate)[0];
  assert.equal(indexed.displayTitle, "Authentication failure");
  assert.equal(indexed.titleSource, "metadata");

  const fallback = buildSessionRecords(sessions, new Map(), {}, translate)[0];
  assert.equal(fallback.displayTitle, "Session 11111111");
  assert.equal(fallback.titleSource, "id");
});

test("buildSessionRecords joins metadata only to filename-derived IDs", () => {
  const extra = new Map(metadata);
  extra.set("22222222-2222-4222-8222-222222222222", {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Hidden index-only session",
    lastMessageDate: 999,
  });

  const records = buildSessionRecords(sessions, extra, {}, translate);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, SESSION_ID);
});

test("normalizeSessionAlias trims whitespace, clears empty values, and caps length", () => {
  assert.equal(
    normalizeSessionAlias("  Local   investigation  "),
    "Local investigation",
  );
  assert.equal(normalizeSessionAlias("  \n  "), undefined);
  assert.equal(
    normalizeSessionAlias("a".repeat(MAX_SESSION_ALIAS_LENGTH)),
    "a".repeat(MAX_SESSION_ALIAS_LENGTH),
  );
  assert.throws(
    () => normalizeSessionAlias("a".repeat(MAX_SESSION_ALIAS_LENGTH + 1)),
    /SessionAliasTooLong/,
  );
});

test("invalid stored aliases are ignored without breaking the list", () => {
  const record = buildSessionRecords(
    sessions,
    metadata,
    {
      [SESSION_ID]: "a".repeat(MAX_SESSION_ALIAS_LENGTH + 1),
    },
    translate,
  )[0];
  assert.equal(record.displayTitle, "Authentication failure");
  assert.equal(record.titleSource, "metadata");
});

test("truncateStatusTitle bounds long status bar labels", () => {
  assert.equal(truncateStatusTitle("short", 10), "short");
  assert.equal(truncateStatusTitle("1234567890", 6), "12345…");
});

test("metadata titles retain the full value but bound the display title", () => {
  const longTitle = "t".repeat(MAX_SESSION_DISPLAY_TITLE_LENGTH + 20);
  const record = buildSessionRecords(
    sessions,
    new Map([
      [SESSION_ID, { id: SESSION_ID, title: longTitle, lastMessageDate: 400 }],
    ]),
    {},
    translate,
  )[0];

  assert.equal(record.metadataTitle, longTitle);
  assert.equal(record.displayTitle.length, MAX_SESSION_DISPLAY_TITLE_LENGTH);
  assert.match(record.displayTitle, /…$/);
});

test("selectSessionRecord never falls back for a missing requested session", () => {
  const records = buildSessionRecords(sessions, metadata, {}, translate);
  assert.equal(selectSessionRecord(records)?.id, SESSION_ID);
  assert.equal(selectSessionRecord(records, SESSION_ID)?.id, SESSION_ID);
  assert.equal(
    selectSessionRecord(records, "22222222-2222-4222-8222-222222222222"),
    undefined,
  );
});
