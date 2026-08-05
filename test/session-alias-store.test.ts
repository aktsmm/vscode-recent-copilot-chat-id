import assert from "node:assert/strict";
import test from "node:test";
import { AliasState, SessionAliasStore } from "../src/session-alias-store";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

class MemoryState implements AliasState {
  readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

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
