import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as scanner from "../src/session-scanner";
import * as sessionModel from "../src/session-model";
import type { SessionTreeNode } from "../src/session-tree";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
type WatchEvent = "create" | "change" | "delete";
interface TestUri {
  readonly path: string;
  toString(): string;
}

function watcherHarness(files: scanner.StoredSessionFile[] = []) {
  const callbacks = new Map<WatchEvent, (uri: TestUri) => void>();
  const pending: Promise<void>[] = [];
  const calls: string[] = [];
  const updates: Array<{ id: string; usage: unknown }> = [];
  const failedStats = new Set<string>();
  const directory = { path: "/sessions", toString: () => "/sessions" };
  const watcher = {
    onDidCreate: (callback: (uri: TestUri) => void) =>
      callbacks.set("create", callback),
    onDidChange: (callback: (uri: TestUri) => void) =>
      callbacks.set("change", callback),
    onDidDelete: (callback: (uri: TestUri) => void) =>
      callbacks.set("delete", callback),
    dispose: () => undefined,
  };
  const vscode = {
    RelativePattern: class {},
    FileType: { File: 1 },
    Uri: {
      joinPath: (directory: TestUri, name: string) => ({
        path: `${directory.path}/${name}`,
        toString: () => `${directory.path}/${name}`,
      }),
    },
    l10n: { t: (message: string) => message },
    commands: {
      executeCommand: async () => {
        calls.push("focus");
      },
    },
    window: {
      showInformationMessage: async () => {
        calls.push("information");
      },
    },
    workspace: {
      createFileSystemWatcher: () => watcher,
      getConfiguration: () => ({ get: () => true }),
      fs: {
        readDirectory: async () => {
          calls.push("list");
          return files.map((file) => [file.name, 1]);
        },
        stat: async (uri: TestUri) => {
          calls.push("stat");
          if (failedStats.has(uri.path.split("/").pop()!)) {
            throw new Error("fixture file disappeared");
          }
          return {
            mtime:
              files.find((file) => uri.path.endsWith(`/${file.name}`))
                ?.modifiedAt ?? 20,
          };
        },
      },
    },
  };
  const exports = {} as {
    createController(): {
      startWatching(directory: TestUri): void;
      readSessions(
        directory: TestUri,
        requestedId?: string,
      ): Promise<scanner.SavedSession[]>;
      refresh(notify: boolean, requestedId?: string): Promise<void>;
      openView(node?: SessionTreeNode): Promise<void>;
      openInspector(node?: SessionTreeNode): Promise<void>;
      analyzeUsage(node?: SessionTreeNode): Promise<void>;
    };
  };
  const source = readFileSync(
    path.join(__dirname, "../src/extension.js"),
    "utf8",
  );
  runInNewContext(
    `${source}\nexports.createController = () => Object.create(RecentChatController.prototype);`,
    {
      exports,
      clearTimeout,
      require: (name: string) => {
        if (name === "vscode") return vscode;
        if (name === "node:path") return path;
        if (name === "./session-scanner") return scanner;
        if (name === "./session-model") return sessionModel;
        return {};
      },
    },
  );
  const controller = Object.assign(exports.createController(), {
    disposed: false,
    scanGeneration: 0,
    usageAnalysisGeneration: 4,
    scanAvailable: true,
    sessions: [{ id: SESSION_ID, modifiedAt: 10 }],
    records: [] as sessionModel.SessionRecord[],
    displayedUsage: new Map([
      [SESSION_ID, { kind: "analyzing" }],
      [OTHER_ID, { kind: "ok" }],
    ]),
    inspectorAnalysis: { cancel: () => calls.push("cancel") },
    inspector: {
      shownSessionId: SESSION_ID,
      update: (id: string, usage: unknown) => updates.push({ id, usage }),
    },
    runSafely: (operation: () => Promise<void>) => pending.push(operation()),
    scheduleRefresh: () => calls.push("refresh"),
    rebuildRecords: async () => {
      calls.push("rebuild");
    },
    renderSessions: () => calls.push("render"),
    logScanResult: () => calls.push("log"),
    resolveSessionDirectory: () => directory,
    output: { warn: () => calls.push("warn") },
  });
  controller.startWatching({ path: "/sessions", toString: () => "/sessions" });
  return {
    controller,
    calls,
    updates,
    failedStats,
    directory,
    async emit(event: WatchEvent, fileName: string) {
      const callback = callbacks.get(event);
      assert.ok(callback, `${event} must be wired to the file watcher`);
      callback({
        path: `/sessions/${fileName}`,
        toString: () => `/sessions/${fileName}`,
      });
      await Promise.all(pending.splice(0));
    },
  };
}

test("targeted refresh checks both siblings, discovers new sessions, and removes vanished entries", async () => {
  const files = [
    { name: `${SESSION_ID}.json`, modifiedAt: 30 },
    { name: `${SESSION_ID}.jsonl`, modifiedAt: 20 },
    { name: `${OTHER_ID}.jsonl`, modifiedAt: 40 },
    { name: "notes.json", modifiedAt: 50 },
  ];
  const harness = watcherHarness(files);
  await harness.controller.refresh(false, SESSION_ID);
  assert.deepEqual(Array.from(harness.controller.sessions), [
    { id: OTHER_ID, modifiedAt: 40 },
    { id: SESSION_ID, modifiedAt: 30 },
  ]);
  assert.equal(harness.calls.filter((call) => call === "stat").length, 3);
  files.splice(0, 2);
  harness.calls.length = 0;
  await harness.controller.refresh(false, SESSION_ID);
  assert.deepEqual(Array.from(harness.controller.sessions), [
    { id: OTHER_ID, modifiedAt: 40 },
  ]);
  assert.equal(harness.calls.filter((call) => call === "stat").length, 0);
});

test("full refresh and cold targeted refresh do not reuse timestamps", async () => {
  const files = [
    { name: `${SESSION_ID}.jsonl`, modifiedAt: 1 },
    { name: `${OTHER_ID}.jsonl`, modifiedAt: 2 },
  ];
  const harness = watcherHarness(files);
  harness.controller.sessions = files.map((file) => ({
    id: scanner.parseSessionId(file.name)!,
    modifiedAt: 999,
  }));
  const expected = scanner.buildSavedSessions(files);
  assert.deepEqual(
    await harness.controller.readSessions(harness.directory),
    expected,
  );
  assert.equal(harness.calls.filter((call) => call === "stat").length, 2);
  harness.controller.sessions = [];
  harness.calls.length = 0;
  assert.deepEqual(
    await harness.controller.readSessions(harness.directory, SESSION_ID),
    expected,
  );
  assert.equal(harness.calls.filter((call) => call === "stat").length, 2);
});

test("a selected file disappearing during stat cannot survive through its cached timestamp", async () => {
  const harness = watcherHarness([
    { name: `${SESSION_ID}.jsonl`, modifiedAt: 20 },
  ]);
  harness.failedStats.add(`${SESSION_ID}.jsonl`);
  await harness.controller.refresh(false, SESSION_ID);
  assert.equal(harness.controller.sessions.length, 0);
  assert.equal(harness.calls.filter((call) => call === "warn").length, 1);
});

test("row commands route their selection to refresh and never substitute a missing selection", async () => {
  for (const command of [
    "openView",
    "openInspector",
    "analyzeUsage",
  ] as const) {
    for (const selected of [true, false]) {
      const harness = watcherHarness();
      const requests: Array<string | undefined> = [];
      harness.controller.refresh = async (_notify, requestedId) => {
        requests.push(requestedId);
      };
      const node: SessionTreeNode = {
        kind: "session",
        record: {
          id: SESSION_ID,
          modifiedAt: 10,
          displayTitle: "Selected",
          titleSource: "id",
        },
      };
      if (selected) {
        harness.controller.records = [
          {
            id: OTHER_ID,
            modifiedAt: 20,
            displayTitle: "Other",
            titleSource: "id",
          },
        ];
      }
      await harness.controller[command](selected ? node : undefined);
      assert.deepEqual(requests, [selected ? SESSION_ID : undefined]);
      assert.equal(
        harness.calls.includes("focus"),
        !selected && command === "openView",
      );
      assert.equal(
        harness.calls.includes("information"),
        selected || command !== "openView",
      );
    }
  }
});

test("targeted refresh discards results superseded by another scan or disposal", async () => {
  for (const disposed of [false, true]) {
    const harness = watcherHarness();
    const original = harness.controller.sessions;
    harness.controller.readSessions = async () => {
      harness.controller.scanGeneration++;
      harness.controller.disposed = disposed;
      return [{ id: OTHER_ID, modifiedAt: 100 }];
    };
    await harness.controller.refresh(false, SESSION_ID);
    assert.equal(harness.controller.sessions, original);
    assert.equal(harness.calls.includes("rebuild"), false);
    assert.equal(harness.calls.includes("render"), false);
    assert.equal(harness.calls.includes("refresh"), !disposed);
  }
});

test("session create, change, and delete invalidate displayed usage before refresh", async () => {
  for (const event of ["create", "change", "delete"] as const) {
    for (const extension of ["json", "jsonl"]) {
      for (const kind of ["ok", "analyzing", "error"]) {
        const harness = watcherHarness();
        harness.controller.displayedUsage.set(SESSION_ID, { kind });
        await harness.emit(event, `${SESSION_ID}.${extension}`);
        assert.equal(harness.controller.displayedUsage.has(SESSION_ID), false);
        assert.equal(harness.controller.displayedUsage.has(OTHER_ID), true);
        assert.equal(harness.controller.usageAnalysisGeneration, 5);
        assert.deepEqual(harness.updates, [
          { id: SESSION_ID, usage: undefined },
        ]);
        assert.deepEqual(
          harness.calls,
          event === "delete"
            ? ["cancel", "refresh"]
            : ["cancel", "stat", "rebuild", "render"],
        );
      }
    }
  }
});

test("watcher invalidation does not replace a different open inspector", async () => {
  const harness = watcherHarness();
  harness.controller.inspector.shownSessionId = OTHER_ID;
  await harness.emit("delete", `${SESSION_ID}.jsonl`);
  assert.equal(harness.controller.displayedUsage.has(SESSION_ID), false);
  assert.deepEqual(harness.updates, []);
});

test("untracked and invalid filenames cannot invalidate another session", async () => {
  for (const event of ["create", "change", "delete"] as const) {
    for (const fileName of [
      "notes.json",
      "33333333-3333-4333-8333-333333333333.jsonl",
    ]) {
      const harness = watcherHarness();
      await harness.emit(event, fileName);
      assert.equal(harness.controller.displayedUsage.size, 2);
      assert.equal(harness.controller.usageAnalysisGeneration, 4);
      assert.equal(harness.calls.includes("cancel"), false);
      assert.deepEqual(harness.updates, []);
    }
  }
});

test("selected-session refresh bounds stat calls while retaining directory checks", async (context) => {
  const files = Array.from({ length: 1000 }, (_, index) => ({
    name: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111.jsonl`,
    modifiedAt: index + 1,
  }));
  const requestedId = scanner.parseSessionId(files[0].name)!;
  const directory = { path: "/sessions", toString: () => "/sessions" };
  const harness = watcherHarness(files);
  harness.controller.sessions = scanner.buildSavedSessions(files);
  await harness.controller.readSessions(directory);
  const baselineStats = harness.calls.filter((call) => call === "stat").length;
  assert.equal(baselineStats, files.length);
  harness.calls.length = 0;
  files[0].modifiedAt = 2000;
  const selected = await harness.controller.readSessions(
    directory,
    requestedId,
  );
  const selectedStats = harness.calls.filter((call) => call === "stat").length;
  context.diagnostic(
    JSON.stringify({
      sessionCount: files.length,
      baselineStats,
      selectedStats,
    }),
  );
  assert.equal(selectedStats, 1);
  assert.equal(harness.calls.filter((call) => call === "list").length, 1);
  assert.equal(selected.length, files.length);
  assert.equal(selected[0].id, requestedId);
  assert.equal(selected[0].modifiedAt, 2000);
});
