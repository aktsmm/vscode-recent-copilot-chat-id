import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSavedSessions,
  isMostRecentAmbiguous,
  parseSessionId,
  shortenSessionId,
  upsertSavedSession,
} from "../src/session-scanner";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

test("parseSessionId accepts UUID .json and .jsonl filenames only", () => {
  assert.equal(parseSessionId(`${FIRST_ID}.json`), FIRST_ID);
  assert.equal(parseSessionId(`${SECOND_ID.toUpperCase()}.jsonl`), SECOND_ID);
  assert.equal(parseSessionId(`${FIRST_ID}.txt`), undefined);
  assert.equal(parseSessionId("session.jsonl"), undefined);
  assert.equal(parseSessionId(`${FIRST_ID}.jsonl.backup`), undefined);
});

test("buildSavedSessions deduplicates IDs and orders by modified time", () => {
  const sessions = buildSavedSessions([
    { name: `${FIRST_ID}.json`, modifiedAt: 100 },
    { name: `${FIRST_ID}.jsonl`, modifiedAt: 300 },
    { name: `${SECOND_ID}.jsonl`, modifiedAt: 200 },
    { name: "notes.json", modifiedAt: 400 },
  ]);

  assert.deepEqual(sessions, [
    { id: FIRST_ID, modifiedAt: 300 },
    { id: SECOND_ID, modifiedAt: 200 },
  ]);
});

test("isMostRecentAmbiguous only flags equal top timestamps", () => {
  assert.equal(
    isMostRecentAmbiguous([
      { id: FIRST_ID, modifiedAt: 300 },
      { id: SECOND_ID, modifiedAt: 300 },
    ]),
    true,
  );
  assert.equal(
    isMostRecentAmbiguous([
      { id: FIRST_ID, modifiedAt: 300 },
      { id: SECOND_ID, modifiedAt: 200 },
    ]),
    false,
  );
});

test("shortenSessionId returns the first UUID segment", () => {
  assert.equal(shortenSessionId(FIRST_ID), "11111111");
});

test("upsertSavedSession inserts a new session in sorted order", () => {
  const sessions = upsertSavedSession([{ id: SECOND_ID, modifiedAt: 200 }], {
    name: `${FIRST_ID}.jsonl`,
    modifiedAt: 300,
  });

  assert.deepEqual(sessions, [
    { id: FIRST_ID, modifiedAt: 300 },
    { id: SECOND_ID, modifiedAt: 200 },
  ]);
});

test("upsertSavedSession keeps one entry per ID and never moves time backwards", () => {
  const updated = upsertSavedSession([{ id: FIRST_ID, modifiedAt: 300 }], {
    name: `${FIRST_ID}.json`,
    modifiedAt: 400,
  });
  assert.deepEqual(updated, [{ id: FIRST_ID, modifiedAt: 400 }]);

  const stale = upsertSavedSession(updated, {
    name: `${FIRST_ID}.jsonl`,
    modifiedAt: 100,
  });
  assert.deepEqual(stale, [{ id: FIRST_ID, modifiedAt: 400 }]);
});

test("upsertSavedSession ignores files that are not session IDs", () => {
  const sessions = [{ id: FIRST_ID, modifiedAt: 300 }];
  const result = upsertSavedSession(sessions, {
    name: "notes.jsonl",
    modifiedAt: 900,
  });

  assert.deepEqual(result, sessions);
  assert.notEqual(result, sessions);
});
