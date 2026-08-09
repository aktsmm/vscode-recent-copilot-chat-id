import * as assert from "node:assert/strict";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import { SessionTreeProvider } from "../../src/session-tree";
import { SessionUsageReader } from "../../src/session-usage-reader";

function verifySqliteCompatibility(): void {
  const fixture = path.join(__dirname, "session-index-fixture.vscdb");
  const writable = new DatabaseSync(fixture);
  try {
    writable.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    writable
      .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
      .run("chat.ChatSessionStore.index", '{"version":1,"entries":{}}');
  } finally {
    writable.close();
  }

  const readOnly = new DatabaseSync(fixture, { readOnly: true });
  try {
    const row = readOnly
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get("chat.ChatSessionStore.index") as { value: string } | undefined;
    assert.equal(row?.value, '{"version":1,"entries":{}}');
    assert.throws(() => readOnly.exec("DELETE FROM ItemTable"));
  } finally {
    readOnly.close();
    // Opening once validates the fixture is released before deletion on Windows.
    closeSync(openSync(fixture, "r"));
    unlinkSync(fixture);
  }
}

function verifySessionTreeProvider(): void {
  const provider = new SessionTreeProvider();
  let refreshes = 0;
  const subscription = provider.onDidChangeTreeData(() => refreshes++);
  try {
    provider.setRecords([
      {
        id: "11111111-1111-4111-8111-111111111111",
        modifiedAt: Date.now() - 60_000,
        displayTitle: "Authentication failure",
        titleSource: "metadata",
      },
    ]);
    assert.equal(refreshes, 1);
    provider.refresh();
    assert.equal(refreshes, 2);

    const [session] = provider.getChildren();
    assert.equal(session.kind, "session");
    const item = provider.getTreeItem(session);
    assert.equal(
      item.collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    assert.equal(item.contextValue, "chatSession");
    assert.equal(item.id, "chat-session:11111111-1111-4111-8111-111111111111");
    assert.equal(item.command?.command, "agShowSessionId.showDetails");
    assert.equal(item.command?.arguments?.[0], session);
    assert.equal(item.accessibilityInformation?.role, "treeitem");
    assert.doesNotMatch(item.accessibilityInformation?.label ?? "", /\$\(/);

    const details = provider.getChildren(session);
    assert.equal(details.length, 3);
    const expectedDetailIds = [
      "chat-session-detail:11111111-1111-4111-8111-111111111111:id",
      "chat-session-detail:11111111-1111-4111-8111-111111111111:saved",
      "chat-session-detail:11111111-1111-4111-8111-111111111111:source",
    ];
    for (const [index, detail] of details.entries()) {
      const detailItem = provider.getTreeItem(detail);
      assert.equal(
        detailItem.collapsibleState,
        vscode.TreeItemCollapsibleState.None,
      );
      assert.equal(
        detailItem.contextValue,
        detail.kind === "detail" && detail.key === "id"
          ? "chatSessionDetailId"
          : "chatSessionDetail",
      );
      assert.equal(detailItem.id, expectedDetailIds[index]);
      const parent = provider.getParent(detail);
      assert.equal(parent?.kind, "session");
      assert.equal(
        parent?.kind === "session" ? parent.record.id : undefined,
        "11111111-1111-4111-8111-111111111111",
      );
      assert.equal(detailItem.accessibilityInformation?.role, "treeitem");
    }
    assert.equal(provider.getParent(session), undefined);

    provider.setRecords([
      {
        id: "11111111-1111-4111-8111-111111111111",
        modifiedAt: Date.now(),
        displayTitle: "Local title",
        alias: "Local title",
        titleSource: "alias",
      },
    ]);
    const aliasItem = provider.getTreeItem(provider.getChildren()[0]);
    assert.equal(aliasItem.contextValue, "chatSessionWithAlias");
  } finally {
    subscription.dispose();
    provider.dispose();
  }
}

async function verifySessionUsageReader(): Promise<void> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "recent-chat-usage-"));
  const otherDirectory = mkdtempSync(
    path.join(os.tmpdir(), "recent-chat-usage-other-"),
  );
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";
  const reader = new SessionUsageReader();
  const tokenSource = new vscode.CancellationTokenSource();
  const token = tokenSource.token;
  const snapshot = (id: string, credits: number) =>
    JSON.stringify({
      version: 3,
      sessionId: id,
      creationDate: 1,
      requests: [
        {
          requestId: "one",
          message: "synthetic secret",
          sessionCopilotCredits: credits,
        },
      ],
    });
  const mutationLog = (id: string, credits: number) =>
    `${JSON.stringify({
      kind: 0,
      v: JSON.parse(snapshot(id, credits)),
    })}\n`;

  try {
    const flatPath = path.join(directory, `${sessionId}.json`);
    const logPath = path.join(directory, `${sessionId}.jsonl`);
    writeFileSync(flatPath, snapshot(sessionId, 3));
    utimesSync(
      flatPath,
      new Date(Date.now() - 20_000),
      new Date(Date.now() - 20_000),
    );
    const flat = await reader.read(
      vscode.Uri.file(directory),
      sessionId,
      token,
    );
    assert.equal(flat.kind, "ok");
    assert.equal(flat.kind === "ok" ? flat.summary.aiCredits : undefined, 3);

    writeFileSync(logPath, mutationLog(sessionId, 8));
    utimesSync(
      logPath,
      new Date(Date.now() - 10_000),
      new Date(Date.now() - 10_000),
    );
    const log = await reader.read(vscode.Uri.file(directory), sessionId, token);
    assert.equal(log.kind, "ok");
    assert.equal(log.kind === "ok" ? log.summary.aiCredits : undefined, 8);

    writeFileSync(logPath, mutationLog(sessionId, 9));
    utimesSync(logPath, new Date(), new Date());
    const refreshed = await reader.read(
      vscode.Uri.file(directory),
      sessionId,
      token,
    );
    assert.equal(refreshed.kind, "ok");
    assert.equal(
      refreshed.kind === "ok" ? refreshed.summary.aiCredits : undefined,
      9,
    );

    writeFileSync(flatPath, snapshot(sessionId, 5));
    utimesSync(
      flatPath,
      new Date(Date.now() + 20_000),
      new Date(Date.now() + 20_000),
    );
    const jsonlPreferred = await reader.read(
      vscode.Uri.file(directory),
      sessionId,
      token,
    );
    assert.equal(jsonlPreferred.kind, "ok");
    assert.equal(
      jsonlPreferred.kind === "ok"
        ? jsonlPreferred.summary.aiCredits
        : undefined,
      9,
    );

    writeFileSync(logPath, "malformed\n");
    utimesSync(logPath, new Date(), new Date());
    const legacyFallback = await reader.read(
      vscode.Uri.file(directory),
      sessionId,
      token,
    );
    assert.equal(legacyFallback.kind, "ok");
    assert.equal(
      legacyFallback.kind === "ok"
        ? legacyFallback.summary.aiCredits
        : undefined,
      5,
    );
    writeFileSync(logPath, mutationLog(sessionId, 9));
    utimesSync(logPath, new Date(), new Date());

    const otherLogPath = path.join(otherDirectory, `${sessionId}.jsonl`);
    const otherContent = mutationLog(sessionId, 7);
    writeFileSync(otherLogPath, otherContent);
    writeFileSync(logPath, mutationLog(sessionId, 9));
    const sharedTime = new Date(Date.now() + 5_000);
    utimesSync(logPath, sharedTime, sharedTime);
    utimesSync(otherLogPath, sharedTime, sharedTime);
    assert.equal(
      Buffer.byteLength(otherContent),
      Buffer.byteLength(mutationLog(sessionId, 9)),
    );
    const otherDirectoryResult = await reader.read(
      vscode.Uri.file(otherDirectory),
      sessionId,
      token,
    );
    assert.equal(otherDirectoryResult.kind, "ok");
    assert.equal(
      otherDirectoryResult.kind === "ok"
        ? otherDirectoryResult.summary.aiCredits
        : undefined,
      7,
    );

    writeFileSync(logPath, mutationLog(otherId, 10));
    utimesSync(
      logPath,
      new Date(Date.now() + 10_000),
      new Date(Date.now() + 10_000),
    );
    const mismatch = await reader.read(
      vscode.Uri.file(directory),
      sessionId,
      token,
    );
    assert.deepEqual(mismatch, {
      kind: "error",
      errorCode: "SessionUsageSessionIdMismatch",
    });

    const cancellation = new vscode.CancellationTokenSource();
    cancellation.cancel();
    const cancelled = await reader.read(
      vscode.Uri.file(directory),
      sessionId,
      cancellation.token,
    );
    assert.deepEqual(cancelled, {
      kind: "error",
      errorCode: "SessionUsageCancelled",
    });
    cancellation.dispose();

    const missing = await reader.read(
      vscode.Uri.file(directory),
      otherId,
      token,
    );
    assert.deepEqual(missing, {
      kind: "error",
      errorCode: "SessionUsageFileNotFound",
    });
    const invalidId = await reader.read(
      vscode.Uri.file(directory),
      "../sensitive",
      token,
    );
    assert.deepEqual(invalidId, {
      kind: "error",
      errorCode: "SessionUsageInvalidSessionId",
    });
  } finally {
    tokenSource.dispose();
    reader.dispose();
    rmSync(directory, { recursive: true, force: true });
    rmSync(otherDirectory, { recursive: true, force: true });
  }
}
async function verifyUsageClearCancelsInFlightRead(): Promise<void> {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const content = Buffer.from(
    `${JSON.stringify({
      kind: 0,
      v: {
        version: 3,
        sessionId,
        creationDate: 1,
        requests: [
          {
            requestId: "one",
            sessionCopilotCredits: 6,
          },
        ],
      },
    })}\n`,
  );
  let resolveRead: ((value: Uint8Array) => void) | undefined;
  let notifyReadStarted: (() => void) | undefined;
  let delayRead = true;
  let readCalls = 0;
  const readStarted = new Promise<void>((resolve) => {
    notifyReadStarted = resolve;
  });
  const fileSystem: Pick<vscode.FileSystem, "stat" | "readFile"> = {
    async stat(uri) {
      return {
        type: uri.path.endsWith(".jsonl")
          ? vscode.FileType.File
          : vscode.FileType.Unknown,
        ctime: 0,
        mtime: 1,
        size: content.byteLength,
      };
    },
    async readFile() {
      readCalls++;
      if (!delayRead) {
        return content;
      }
      notifyReadStarted?.();
      return new Promise<Uint8Array>((resolve) => {
        resolveRead = resolve;
      });
    },
  };
  const reader = new SessionUsageReader(fileSystem);
  const tokenSource = new vscode.CancellationTokenSource();
  try {
    const inFlight = reader.read(
      vscode.Uri.file("/synthetic-chat-sessions"),
      sessionId,
      tokenSource.token,
    );
    await readStarted;
    reader.clear();
    resolveRead?.(content);
    assert.deepEqual(await inFlight, {
      kind: "error",
      errorCode: "SessionUsageCancelled",
    });

    delayRead = false;
    const afterClear = await reader.read(
      vscode.Uri.file("/synthetic-chat-sessions"),
      sessionId,
      tokenSource.token,
    );
    assert.equal(afterClear.kind, "ok");
    assert.equal(readCalls, 2, "clear must prevent an in-flight cache write");
  } finally {
    tokenSource.dispose();
    reader.dispose();
  }
}
async function verifyUsageRejectsPostReadSymlink(): Promise<void> {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const content = Buffer.from(
    `${JSON.stringify({
      kind: 0,
      v: {
        version: 3,
        sessionId,
        creationDate: 1,
        requests: [{ requestId: "one", copilotCredits: 1 }],
      },
    })}\n`,
  );
  let jsonlStatCalls = 0;
  const fileSystem: Pick<vscode.FileSystem, "stat" | "readFile"> = {
    async stat(uri) {
      if (!uri.path.endsWith(".jsonl")) {
        return {
          type: vscode.FileType.Unknown,
          ctime: 0,
          mtime: 0,
          size: 0,
        };
      }
      jsonlStatCalls++;
      return {
        type:
          jsonlStatCalls === 1
            ? vscode.FileType.File
            : vscode.FileType.File | vscode.FileType.SymbolicLink,
        ctime: 0,
        mtime: 1,
        size: content.byteLength,
      };
    },
    async readFile() {
      return content;
    },
  };
  const reader = new SessionUsageReader(fileSystem);
  const tokenSource = new vscode.CancellationTokenSource();
  try {
    assert.deepEqual(
      await reader.read(
        vscode.Uri.file("/synthetic-chat-sessions"),
        sessionId,
        tokenSource.token,
      ),
      { kind: "error", errorCode: "SessionUsageFileChanged" },
    );
  } finally {
    tokenSource.dispose();
    reader.dispose();
  }
}
async function verifyUsageFallsBackWhenJsonlDisappears(): Promise<void> {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const snapshot = Buffer.from(
    JSON.stringify({
      version: 3,
      sessionId,
      creationDate: 1,
      requests: [{ requestId: "one", copilotCredits: 4 }],
    }),
  );
  const fileSystem: Pick<vscode.FileSystem, "stat" | "readFile"> = {
    async stat() {
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 1,
        size: snapshot.byteLength,
      };
    },
    async readFile(uri) {
      if (uri.path.endsWith(".jsonl")) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      return snapshot;
    },
  };
  const reader = new SessionUsageReader(fileSystem);
  const tokenSource = new vscode.CancellationTokenSource();
  try {
    const result = await reader.read(
      vscode.Uri.file("/synthetic-chat-sessions"),
      sessionId,
      tokenSource.token,
    );
    assert.equal(result.kind, "ok");
    assert.equal(
      result.kind === "ok" ? result.summary.aiCredits : undefined,
      4,
    );
  } finally {
    tokenSource.dispose();
    reader.dispose();
  }
}
async function verifyUsageErrorsAreNormalized(): Promise<void> {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const stat = {
    type: vscode.FileType.File,
    ctime: 0,
    mtime: 1,
    size: 1,
  };
  for (const [thrown, expected] of [
    [
      vscode.FileSystemError.FileNotFound(vscode.Uri.file("/gone.jsonl")),
      "SessionUsageFileNotFound",
    ],
    [
      Object.assign(new Error("private"), { name: "SecretToken123" }),
      "SessionUsageReadFailed",
    ],
  ] as const) {
    const reader = new SessionUsageReader({
      async stat(uri) {
        return uri.path.endsWith(".jsonl")
          ? stat
          : { ...stat, type: vscode.FileType.Unknown };
      },
      async readFile() {
        throw thrown;
      },
    });
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      assert.deepEqual(
        await reader.read(
          vscode.Uri.file("/synthetic-chat-sessions"),
          sessionId,
          tokenSource.token,
        ),
        { kind: "error", errorCode: expected },
      );
    } finally {
      tokenSource.dispose();
      reader.dispose();
    }
  }
}
async function verifyUsageWorkerTransfersBytes(): Promise<void> {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const content = Buffer.from(
    `${JSON.stringify({
      kind: 0,
      v: {
        version: 3,
        sessionId,
        creationDate: 1,
        requests: [],
        ignoredPadding: "x".repeat(512 * 1024),
      },
    })}\n`,
  );
  let transferredBytes: Uint8Array | undefined;
  const fileSystem: Pick<vscode.FileSystem, "stat" | "readFile"> = {
    async stat(uri) {
      return {
        type: uri.path.endsWith(".jsonl")
          ? vscode.FileType.File
          : vscode.FileType.Unknown,
        ctime: 0,
        mtime: 1,
        size: content.byteLength,
      };
    },
    async readFile() {
      transferredBytes = Uint8Array.from(content);
      return transferredBytes;
    },
  };
  const reader = new SessionUsageReader(fileSystem);
  const tokenSource = new vscode.CancellationTokenSource();
  try {
    const result = await reader.read(
      vscode.Uri.file("/synthetic-chat-sessions"),
      sessionId,
      tokenSource.token,
    );
    assert.equal(result.kind, "ok");
    assert.equal(
      result.kind === "ok" ? result.summary.requestCount : undefined,
      0,
    );
    assert.equal(transferredBytes?.byteLength, 0);
  } finally {
    tokenSource.dispose();
    reader.dispose();
  }
}
async function verifyUsageWorkerCleanupAndProtocol(): Promise<void> {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const bytes = Uint8Array.from([123]);
  const fileSystem: Pick<vscode.FileSystem, "stat" | "readFile"> = {
    async stat(uri) {
      return {
        type: uri.path.endsWith(".jsonl")
          ? vscode.FileType.File
          : vscode.FileType.Unknown,
        ctime: 0,
        mtime: 1,
        size: bytes.byteLength,
      };
    },
    async readFile() {
      return Uint8Array.from(bytes);
    },
  };

  for (const behavior of [
    "throw",
    "invalid-result",
    "extra-summary",
    "null-unattributed",
    "too-many-models",
    "duplicate-models",
    "long-model",
    "inherited-envelope",
    "hidden-extra",
    "cancel-race",
  ] as const) {
    let messageListener: ((value: unknown) => void) | undefined;
    let errorListener: ((value: unknown) => void) | undefined;
    let exitListener: ((value: unknown) => void) | undefined;
    let notifyPosted: (() => void) | undefined;
    const posted = new Promise<void>((resolve) => {
      notifyPosted = resolve;
    });
    let terminateCalls = 0;
    const fakeWorker = {
      once(event: string, listener: (value: unknown) => void) {
        if (event === "message") {
          messageListener = listener;
        } else if (event === "error") {
          errorListener = listener;
        } else if (event === "exit") {
          exitListener = listener;
        }
        return fakeWorker;
      },
      postMessage() {
        if (behavior === "throw") {
          throw Object.assign(new Error("clone failed"), {
            name: "DataCloneError",
          });
        }
        notifyPosted?.();
        if (behavior === "cancel-race") {
          return;
        }
        if (behavior === "inherited-envelope") {
          queueMicrotask(() =>
            messageListener?.(
              Object.create({
                kind: "ok",
                summary: { sessionId, requestCount: 0, models: [] },
              }),
            ),
          );
          return;
        }
        let summary: unknown = { sessionId };
        if (behavior === "extra-summary") {
          summary = {
            sessionId,
            requestCount: 0,
            models: [],
            prompt: "must-not-cache",
          };
        } else if (behavior === "null-unattributed") {
          summary = {
            sessionId,
            requestCount: 0,
            models: [],
            unattributedTokens: null,
          };
        } else if (behavior === "too-many-models") {
          summary = {
            sessionId,
            requestCount: 0,
            models: Array.from({ length: 101 }, (_, index) => ({
              model: `model-${index}`,
              inputTokens: 0,
              cachedTokens: 0,
              outputTokens: 0,
            })),
          };
        } else if (behavior === "duplicate-models") {
          summary = {
            sessionId,
            requestCount: 0,
            models: [
              {
                model: "duplicate",
                inputTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
              },
              {
                model: "duplicate",
                inputTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
              },
            ],
          };
        } else if (behavior === "long-model") {
          summary = {
            sessionId,
            requestCount: 0,
            models: [
              {
                model: "x".repeat(201),
                inputTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
              },
            ],
          };
        } else if (behavior === "hidden-extra") {
          summary = { sessionId, requestCount: 0, models: [] };
          Object.defineProperty(summary, "prompt", {
            value: "must-not-cache",
            enumerable: false,
          });
        }
        queueMicrotask(() => messageListener?.({ kind: "ok", summary }));
      },
      async terminate() {
        terminateCalls++;
        return 0;
      },
    } as unknown as Worker;
    const reader = new SessionUsageReader(fileSystem, () => fakeWorker);
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const result = reader.read(
        vscode.Uri.file("/synthetic-chat-sessions"),
        sessionId,
        tokenSource.token,
      );
      if (behavior === "cancel-race") {
        await posted;
        tokenSource.cancel();
        errorListener?.(new Error("late error"));
        exitListener?.(1);
      }
      assert.deepEqual(
        await result,
        behavior === "cancel-race"
          ? { kind: "error", errorCode: "SessionUsageCancelled" }
          : { kind: "error", errorCode: "SessionUsageReadFailed" },
      );
      reader.clear();
      tokenSource.cancel();
      assert.equal(terminateCalls, 1);
    } finally {
      tokenSource.dispose();
      reader.dispose();
    }
  }
}
export async function run(): Promise<void> {
  verifySqliteCompatibility();
  verifySessionTreeProvider();
  await verifySessionUsageReader();
  await verifyUsageClearCancelsInFlightRead();
  await verifyUsageRejectsPostReadSymlink();
  await verifyUsageFallsBackWhenJsonlDisappears();
  await verifyUsageErrorsAreNormalized();
  await verifyUsageWorkerTransfersBytes();
  await verifyUsageWorkerCleanupAndProtocol();
  const extension = vscode.extensions.getExtension(
    "yamapan.ag-show-session-id",
  );
  assert.ok(extension, "Extension is not installed in the development host");

  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "agShowSessionId.refresh",
    "agShowSessionId.copyRecent",
    "agShowSessionId.showSessions",
    "agShowSessionId.showOutput",
    "agShowSessionId.openView",
    "agShowSessionId.copySession",
    "agShowSessionId.copySessionId",
    "agShowSessionId.openInspector",
    "agShowSessionId.analyzeUsage",
    "agShowSessionId.showDetails",
    "agShowSessionId.setAlias",
    "agShowSessionId.clearAlias",
    "agShowSessionId.openSettings",
    "agShowSessionId.enable",
    "agShowSessionId.enableTitles",
  ]) {
    assert.ok(
      commands.includes(command),
      `Command is not registered: ${command}`,
    );
  }

  const configuration = vscode.workspace.getConfiguration("agShowSessionId");
  assert.equal(configuration.get<boolean>("enabled"), false);
  assert.equal(configuration.get<boolean>("readTitles"), false);
  assert.equal(configuration.get<boolean>("readUsage"), false);
  await configuration.update(
    "enabled",
    true,
    vscode.ConfigurationTarget.Global,
  );

  try {
    await vscode.commands.executeCommand("agShowSessionId.refresh");
    await vscode.commands.executeCommand("agShowSessionId.showOutput");
    await vscode.commands.executeCommand("agShowSessionId.openView");
    await vscode.commands.executeCommand("agShowSessionId.showDetails", {
      kind: "session",
      record: {
        id: "33333333-3333-4333-8333-333333333333",
        modifiedAt: Date.now(),
        displayTitle: "Stale test session",
        titleSource: "id",
      },
    });
    await configuration.update(
      "readTitles",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await vscode.commands.executeCommand("agShowSessionId.refresh");

    await Promise.all([
      vscode.commands.executeCommand("agShowSessionId.refresh"),
      vscode.commands.executeCommand("agShowSessionId.refresh"),
      vscode.commands.executeCommand("agShowSessionId.showOutput"),
    ]);
  } finally {
    await configuration.update(
      "readTitles",
      false,
      vscode.ConfigurationTarget.Global,
    );
    await configuration.update(
      "enabled",
      false,
      vscode.ConfigurationTarget.Global,
    );
  }

  process.stdout.write(
    [
      `Extension Host smoke tests passed (${vscode.workspace.workspaceFolders ? "workspace window" : "empty window"}):`,
      "- extension activated",
      "- fifteen commands registered",
      "- scanning disabled by default",
      "- opt-in refresh completed",
      "- output command completed",
      "- concurrent refreshes completed",
      "- node:sqlite read-only fixture completed",
      "- session browser and title opt-in completed",
      "- TreeItem interaction contracts completed",
      "- selected-session usage reader contracts completed",
    ].join("\n") + "\n",
  );
}
