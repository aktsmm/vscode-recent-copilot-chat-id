import assert from "node:assert/strict";
import test from "node:test";
import { copySessionIdWithRecovery } from "../src/copy-session";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

test("copySessionIdWithRecovery reports success after writing the full ID", async () => {
  const calls: string[] = [];

  await copySessionIdWithRecovery(SESSION_ID, {
    async writeText(value) {
      calls.push(`write:${value}`);
    },
    showSuccess(shortId) {
      calls.push(`success:${shortId}`);
    },
    async showFailure() {
      calls.push("failure");
      return false;
    },
    showLog() {
      calls.push("log");
    },
  });

  assert.deepEqual(calls, [`write:${SESSION_ID}`, "success:11111111"]);
});

test("copySessionIdWithRecovery offers and opens logs after a write failure", async () => {
  const expected = new Error("clipboard denied");
  const calls: unknown[] = [];

  await copySessionIdWithRecovery(SESSION_ID, {
    async writeText() {
      throw expected;
    },
    showSuccess(shortId) {
      calls.push(`success:${shortId}`);
    },
    async showFailure(error) {
      calls.push(error);
      return true;
    },
    showLog() {
      calls.push("log");
    },
  });

  assert.deepEqual(calls, [expected, "log"]);
});

test("copySessionIdWithRecovery keeps logs closed when the user dismisses recovery", async () => {
  const calls: string[] = [];

  await copySessionIdWithRecovery(SESSION_ID, {
    async writeText() {
      throw new Error("clipboard denied");
    },
    showSuccess() {
      calls.push("success");
    },
    async showFailure() {
      calls.push("failure");
      return false;
    },
    showLog() {
      calls.push("log");
    },
  });

  assert.deepEqual(calls, ["failure"]);
});
