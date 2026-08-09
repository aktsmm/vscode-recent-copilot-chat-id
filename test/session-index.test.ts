import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CHAT_SESSION_INDEX_KEY,
  MAX_SESSION_INDEX_BYTES,
  MAX_SESSION_INDEX_ENTRIES,
  MAX_SESSION_METADATA_TITLE_LENGTH,
  parseSessionIndex,
  readSessionIndex,
  resolveSessionIndexPath,
} from "../src/session-index";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function withDatabase(
  value: string | undefined,
  callback: (file: string) => void,
): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "recent-chat-index-"));
  const file = path.join(directory, "state.vscdb");
  const database = new DatabaseSync(file);
  try {
    database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    if (value !== undefined) {
      database
        .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
        .run(CHAT_SESSION_INDEX_KEY, value);
    }
  } finally {
    database.close();
  }

  try {
    callback(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("parseSessionIndex keeps only approved metadata fields", () => {
  const entries = parseSessionIndex(
    JSON.stringify({
      version: 1,
      entries: {
        [SESSION_ID]: {
          sessionId: SESSION_ID.toUpperCase(),
          title: "Authentication failure",
          lastMessageDate: 1234,
          workingDirectory: "must-not-be-retained",
          inputState: { prompt: "must-not-be-retained" },
        },
      },
    }),
  );

  assert.deepEqual(entries.get(SESSION_ID), {
    id: SESSION_ID,
    title: "Authentication failure",
    lastMessageDate: 1234,
  });
  assert.deepEqual(Object.keys(entries.get(SESSION_ID) ?? {}).sort(), [
    "id",
    "lastMessageDate",
    "title",
  ]);
});

test("parseSessionIndex retains validated timing, stats, and response state", () => {
  const entries = parseSessionIndex(
    JSON.stringify({
      version: 1,
      entries: {
        [SESSION_ID]: {
          sessionId: SESSION_ID,
          title: "Authentication failure",
          lastMessageDate: 1234,
          timing: {
            created: 1000,
            lastRequestStarted: 1100,
            lastRequestEnded: 1200,
          },
          stats: { fileCount: 2, added: 30, removed: 4 },
          lastResponseState: 1,
        },
      },
    }),
  );

  assert.deepEqual(entries.get(SESSION_ID), {
    id: SESSION_ID,
    title: "Authentication failure",
    lastMessageDate: 1234,
    timing: {
      created: 1000,
      lastRequestStarted: 1100,
      lastRequestEnded: 1200,
    },
    stats: { fileCount: 2, added: 30, removed: 4 },
    lastResponseState: "complete",
  });
});

test("parseSessionIndex rejects malformed optional metadata", () => {
  for (const extra of [
    { timing: { created: -1 } },
    { stats: { fileCount: 1, added: -1, removed: 0 } },
    { lastResponseState: 9 },
  ]) {
    assert.throws(() =>
      parseSessionIndex(
        JSON.stringify({
          version: 1,
          entries: {
            [SESSION_ID]: {
              sessionId: SESSION_ID,
              title: "Invalid optional metadata",
              lastMessageDate: 1,
              ...extra,
            },
          },
        }),
      ),
    );
  }
});

test("parseSessionIndex accepts partial timing and zero stats", () => {
  const entries = parseSessionIndex(
    JSON.stringify({
      version: 1,
      entries: {
        [SESSION_ID]: {
          sessionId: SESSION_ID,
          title: "Partial metadata",
          lastMessageDate: 1,
          timing: { created: 0, lastRequestEnded: 1 },
          stats: { fileCount: 0, added: 0, removed: 0 },
        },
      },
    }),
  );
  assert.deepEqual(entries.get(SESSION_ID)?.timing, {
    created: 0,
    lastRequestEnded: 1,
  });
  assert.deepEqual(entries.get(SESSION_ID)?.stats, {
    fileCount: 0,
    added: 0,
    removed: 0,
  });
});

test("parseSessionIndex rejects unsupported versions and malformed entries", () => {
  assert.throws(
    () => parseSessionIndex('{"version":2,"entries":{}}'),
    /UnsupportedSessionIndex/,
  );
  assert.throws(
    () =>
      parseSessionIndex(
        JSON.stringify({
          version: 1,
          entries: {
            [SESSION_ID]: {
              sessionId: SESSION_ID,
              title: 4,
              lastMessageDate: 1,
            },
          },
        }),
      ),
    /InvalidSessionIndexEntry/,
  );
  assert.throws(() => parseSessionIndex("not-json"), SyntaxError);
  assert.throws(
    () =>
      parseSessionIndex(
        JSON.stringify({
          version: 1,
          entries: {
            "22222222-2222-4222-8222-222222222222": {
              sessionId: SESSION_ID,
              title: "Wrong key",
              lastMessageDate: 1,
            },
          },
        }),
      ),
    /InvalidSessionIndexIdentity/,
  );
});

test("parseSessionIndex ignores external provider sessions", () => {
  const entries = parseSessionIndex(
    JSON.stringify({
      version: 1,
      entries: {
        "cloud://session/1": {
          sessionId: "cloud://session/1",
          title: "External session",
          lastMessageDate: 1,
        },
      },
    }),
  );
  assert.equal(entries.size, 0);
});

test("parseSessionIndex retains only allowed filename-derived sessions", () => {
  const other = "22222222-2222-4222-8222-222222222222";
  const entries = parseSessionIndex(
    JSON.stringify({
      version: 1,
      entries: {
        [SESSION_ID]: {
          sessionId: SESSION_ID,
          title: "Allowed",
          lastMessageDate: 1,
        },
        [other]: {
          sessionId: other,
          title: "Not retained",
          lastMessageDate: 2,
        },
      },
    }),
    new Set([SESSION_ID]),
  );
  assert.deepEqual([...entries.keys()], [SESSION_ID]);
});

test("parseSessionIndex rejects excessive entries and title lengths", () => {
  const excessiveEntries = Object.fromEntries(
    Array.from({ length: MAX_SESSION_INDEX_ENTRIES + 1 }, (_, index) => [
      `external-${index}`,
      {},
    ]),
  );
  assert.throws(
    () =>
      parseSessionIndex(
        JSON.stringify({ version: 1, entries: excessiveEntries }),
      ),
    /TooManySessionIndexEntries/,
  );

  assert.throws(
    () =>
      parseSessionIndex(
        JSON.stringify({
          version: 1,
          entries: {
            [SESSION_ID]: {
              sessionId: SESSION_ID,
              title: "t".repeat(MAX_SESSION_METADATA_TITLE_LENGTH + 1),
              lastMessageDate: 1,
            },
          },
        }),
      ),
    /SessionMetadataTitleTooLong/,
  );
});

test("readSessionIndex queries the single index key from a read-only database", () => {
  withDatabase(
    JSON.stringify({
      version: 1,
      entries: {
        [SESSION_ID]: {
          sessionId: SESSION_ID,
          title: "Authentication failure",
          lastMessageDate: 1234,
        },
      },
    }),
    (file) => {
      const result = readSessionIndex(file);
      assert.equal(result.errorCode, undefined);
      assert.equal(
        result.entries.get(SESSION_ID)?.title,
        "Authentication failure",
      );
    },
  );
});

test("readSessionIndex degrades for missing keys, malformed values, and missing databases", () => {
  withDatabase(undefined, (file) => {
    const result = readSessionIndex(file);
    assert.equal(result.entries.size, 0);
    assert.equal(result.errorCode, "IndexNotFound");
  });

  withDatabase("not-json", (file) => {
    const result = readSessionIndex(file);
    assert.equal(result.entries.size, 0);
    assert.equal(result.errorCode, "SessionIndexReadFailed");
  });

  const result = readSessionIndex(
    path.join(os.tmpdir(), "missing-state-vscdb"),
  );
  assert.equal(result.entries.size, 0);
  assert.equal(typeof result.errorCode, "string");
});

test("readSessionIndex rejects oversized values before parsing", () => {
  withDatabase("x".repeat(MAX_SESSION_INDEX_BYTES + 1), (file) => {
    const result = readSessionIndex(file, new Set([SESSION_ID]));
    assert.equal(result.entries.size, 0);
    assert.equal(result.errorCode, "SessionIndexTooLarge");
  });
});

test("resolveSessionIndexPath selects workspace or global storage siblings", () => {
  assert.equal(
    resolveSessionIndexPath(
      path.join("root", "workspace", "extension-id"),
      path.join("root", "global", "extension-id"),
    ),
    path.join("root", "workspace", "state.vscdb"),
  );
  assert.equal(
    resolveSessionIndexPath(
      undefined,
      path.join("root", "global", "extension-id"),
    ),
    path.join("root", "global", "state.vscdb"),
  );
});
