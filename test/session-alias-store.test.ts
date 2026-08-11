import assert from "node:assert/strict";
import test from "node:test";
import { AliasState, SessionAliasStore } from "../src/session-alias-store";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

class MemoryState implements AliasState {
  readonly values = new Map<string, unknown>();
  legacyReads = 0;

  get<T>(key: string, defaultValue: T): T {
    if (key === "agShowSessionId.sessionAliases") {
      this.legacyReads++;
    }
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

test("SessionAliasStore reads each legacy map once per batch", async () => {
  const state = new MemoryState();
  const workspace = new MemoryState();
  const store = new SessionAliasStore(state, [workspace]);
  const ids = Array.from(
    { length: 50 },
    (_, index) =>
      `1111111${index % 10}-1111-4111-8111-11111111111${index % 10}`,
  );

  store.getAll(ids);
  assert.equal(state.legacyReads, 1);
  assert.equal(workspace.legacyReads, 1);

  state.legacyReads = 0;
  workspace.legacyReads = 0;
  await store.migrate(ids);
  assert.equal(state.legacyReads, 1);
  assert.equal(workspace.legacyReads, 1);
});

test("SessionAliasStore keeps the same precedence for every source", () => {
  const state = new MemoryState();
  const workspace = new MemoryState();
  const store = new SessionAliasStore(state, [workspace]);
  const ids = ["a", "b", "c", "d", "e"];

  state.values.set("agShowSessionId.sessionAlias.a", "primary direct");
  state.values.set("agShowSessionId.sessionAliases", {
    a: "primary legacy",
    b: "primary legacy",
  });
  state.values.set("agShowSessionId.sessionAlias.c", null);
  workspace.values.set("agShowSessionId.sessionAlias.c", "workspace direct");
  workspace.values.set("agShowSessionId.sessionAlias.d", "workspace direct");
  workspace.values.set("agShowSessionId.sessionAliases", {
    d: "workspace legacy",
    e: "workspace legacy",
  });

  assert.deepEqual(store.getAll(ids), {
    a: "primary direct",
    b: "primary legacy",
    d: "workspace direct",
    e: "workspace legacy",
  });
  for (const id of ids) {
    assert.equal(store.get(id), store.getAll(ids)[id], id);
  }
});

test("SessionAliasStore saves normalized aliases and clears them", async () => {
  const state = new MemoryState();
  const store = new SessionAliasStore(state);

  await store.set(SESSION_ID, "  Local   investigation ");
  assert.equal(store.get(SESSION_ID), "Local investigation");
  assert.deepEqual(store.getAll([SESSION_ID]), {
    [SESSION_ID]: "Local investigation",
  });

  await store.clear(SESSION_ID);
  assert.equal(store.get(SESSION_ID), undefined);
});

test("SessionAliasStore ignores malformed persisted values", () => {
  const state = new MemoryState();
  state.values.set("agShowSessionId.sessionAliases", {
    [SESSION_ID]: "Valid alias",
    invalid: 42,
  });

  assert.deepEqual(new SessionAliasStore(state).getAll(), {
    [SESSION_ID]: "Valid alias",
  });
});

test("SessionAliasStore updates IDs independently", async () => {
  const state = new MemoryState();
  const store = new SessionAliasStore(state);
  const second = "22222222-2222-4222-8222-222222222222";

  await Promise.all([
    store.set(SESSION_ID, "First"),
    store.set(second, "Second"),
  ]);

  assert.deepEqual(store.getAll([SESSION_ID, second]), {
    [SESSION_ID]: "First",
    [second]: "Second",
  });
});

test("SessionAliasStore migrates a legacy workspace alias to primary state", async () => {
  const primary = new MemoryState();
  const workspace = new MemoryState();
  workspace.values.set("agShowSessionId.sessionAliases", {
    [SESSION_ID]: "Legacy title",
  });
  const store = new SessionAliasStore(primary, [workspace]);

  await store.migrate([SESSION_ID]);

  assert.equal(store.get(SESSION_ID), "Legacy title");
  assert.equal(
    primary.values.get(`agShowSessionId.sessionAlias.${SESSION_ID}`),
    "Legacy title",
  );
});

test("SessionAliasStore tombstone prevents a cleared legacy alias from returning", async () => {
  const primary = new MemoryState();
  primary.values.set("agShowSessionId.sessionAliases", {
    [SESSION_ID]: "Legacy title",
  });
  const store = new SessionAliasStore(primary);

  assert.equal(store.get(SESSION_ID), "Legacy title");
  await store.clear(SESSION_ID);
  assert.equal(store.get(SESSION_ID), undefined);
  assert.equal(
    primary.values.get(`agShowSessionId.sessionAlias.${SESSION_ID}`),
    null,
  );
});
