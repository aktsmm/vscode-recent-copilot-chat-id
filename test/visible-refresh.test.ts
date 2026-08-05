import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionTreeRows } from "../src/session-tree-model";
import { TimerPort, VisibleRefreshScheduler } from "../src/visible-refresh";

class FakeTimers implements TimerPort {
  callbacks = new Map<number, () => void>();
  cleared: number[] = [];
  next = 1;

  set(callback: () => void): number {
    const handle = this.next++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clear(handle: unknown): void {
    this.cleared.push(handle as number);
    this.callbacks.delete(handle as number);
  }

  fire(handle: number): void {
    const callback = this.callbacks.get(handle);
    this.callbacks.delete(handle);
    callback?.();
  }
}

test("VisibleRefreshScheduler refreshes only while visible", () => {
  const timers = new FakeTimers();
  let refreshes = 0;
  const scheduler = new VisibleRefreshScheduler(
    () => refreshes++,
    60_000,
    timers,
  );

  scheduler.setVisible(false);
  assert.equal(timers.callbacks.size, 0);

  scheduler.setVisible(true);
  assert.equal(timers.callbacks.size, 1);
  timers.fire(1);
  assert.equal(refreshes, 1);
  assert.equal(timers.callbacks.size, 1);

  scheduler.setVisible(false);
  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(timers.cleared, [2]);
});

test("VisibleRefreshScheduler cancels and stays stopped after disposal", () => {
  const timers = new FakeTimers();
  let refreshes = 0;
  const scheduler = new VisibleRefreshScheduler(
    () => refreshes++,
    60_000,
    timers,
  );

  scheduler.setVisible(true);
  scheduler.dispose();
  assert.equal(timers.callbacks.size, 0);
  scheduler.setVisible(true);
  assert.equal(timers.callbacks.size, 0);
  assert.equal(refreshes, 0);
});

test("VisibleRefreshScheduler updates a rendered relative-time description", () => {
  const timers = new FakeTimers();
  const savedAt = Date.UTC(2026, 7, 5, 10, 0);
  let now = savedAt + 60_000;
  const record = {
    id: "11111111-1111-4111-8111-111111111111",
    modifiedAt: savedAt,
    displayTitle: "Authentication failure",
    titleSource: "metadata" as const,
  };
  const translate = (message: string, ...args: string[]) =>
    args.reduce(
      (text, value, index) => text.replaceAll(`{${index}}`, value),
      message,
    );
  let description = buildSessionTreeRows([record], "en-US", translate, now)[0]
    .description;
  const scheduler = new VisibleRefreshScheduler(
    () => {
      description = buildSessionTreeRows([record], "en-US", translate, now)[0]
        .description;
    },
    60_000,
    timers,
  );

  assert.match(description, /1 minute ago$/);
  scheduler.setVisible(true);
  now = savedAt + 2 * 60_000;
  timers.fire(1);
  assert.match(description, /2 minutes ago$/);
});
