import * as vscode from "vscode";
import path from "node:path";
import {
  CopySessionPort,
  copySessionIdWithRecovery,
  copySessionWithTitleWithRecovery,
} from "./copy-session";
import { SessionAliasStore } from "./session-alias-store";
import { enableAllLocalFeatures } from "./enable-all-features";
import {
  canAnalyzeOnInspectorOpen,
  InspectorUsageSettings,
  shouldApplyInspectorUsage,
} from "./inspector-usage-gate";
import { SessionInspector } from "./session-inspector";
import { buildSessionQuickPickEntries } from "./session-quick-pick";
import {
  SessionUsageReader,
  SessionUsageReadResult,
} from "./session-usage-reader";
import {
  describeSessionUsageError,
  SessionInspectorUsage,
} from "./session-inspector-model";
import {
  readSessionIndex,
  resolveSessionIndexPath,
  SESSION_INDEX_DATABASE_GLOB,
  SessionIndexMetadata,
} from "./session-index";
import {
  buildSessionRecords,
  MAX_SESSION_ALIAS_LENGTH,
  normalizeSessionAlias,
  selectSessionRecord,
  SessionRecord,
  stripStatusIcons,
} from "./session-model";
import {
  buildSavedSessions,
  isMostRecentAmbiguous,
  parseSessionId,
  SavedSession,
  shortenSessionId,
  StoredSessionFile,
  upsertSavedSession,
} from "./session-scanner";
import {
  describeRecordStatus,
  describeUnavailableStatus,
  RecentChatStatus,
  RecentChatStatusKind,
} from "./status-presentation";
import {
  SessionNode,
  SessionTreeNode,
  SessionTreeProvider,
} from "./session-tree";
import { VisibleRefreshScheduler } from "./visible-refresh";

const CONFIG_SECTION = "agShowSessionId";
const ENABLED_SETTING = "enabled";
const READ_TITLES_SETTING = "readTitles";
const READ_USAGE_SETTING = "readUsage";
const ANALYZE_ON_OPEN_SETTING = "analyzeUsageOnInspectorOpen";
const INTRO_SHOWN_KEY = "agShowSessionId.introShown";
const VIEW_ID = "agShowSessionId.sessionsView";
const COMMANDS = {
  refresh: "agShowSessionId.refresh",
  copyRecent: "agShowSessionId.copyRecent",
  showSessions: "agShowSessionId.showSessions",
  showOutput: "agShowSessionId.showOutput",
  openView: "agShowSessionId.openView",
  copySession: "agShowSessionId.copySession",
  copySessionId: "agShowSessionId.copySessionId",
  openInspector: "agShowSessionId.openInspector",
  analyzeUsage: "agShowSessionId.analyzeUsage",
  showDetails: "agShowSessionId.showDetails",
  setAlias: "agShowSessionId.setAlias",
  clearAlias: "agShowSessionId.clearAlias",
  openSettings: "agShowSessionId.openSettings",
  enable: "agShowSessionId.enable",
  enableTitles: "agShowSessionId.enableTitles",
  enableAll: "agShowSessionId.enableAll",
} as const;
const STATUS_COMMANDS: Record<RecentChatStatusKind, string> = {
  recent: COMMANDS.openView,
  ambiguous: COMMANDS.openView,
  empty: COMMANDS.openView,
  unavailable: COMMANDS.showOutput,
};

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(
    vscode.l10n.t("Recent Copilot Chat ID"),
    { log: true },
  );
  const controller = new RecentChatController(context, output);

  context.subscriptions.push(controller);
  controller.registerCommands(context);
  controller.runSafely(() => controller.refresh(false));
  controller.runSafely(() => controller.showIntroOnce());
}

export function deactivate(): void {}

class RecentChatController implements vscode.Disposable {
  private readonly statusBar = vscode.window.createStatusBarItem(
    "agShowSessionId.recentChat",
    vscode.StatusBarAlignment.Right,
    100,
  );
  private sessions: SavedSession[] = [];
  private records: SessionRecord[] = [];
  private readonly aliasStore: SessionAliasStore;
  private readonly treeProvider = new SessionTreeProvider();
  private readonly inspector = new SessionInspector();
  private readonly usageReader = new SessionUsageReader();
  private readonly displayedUsage = new Map<string, SessionInspectorUsage>();
  private readonly treeView: vscode.TreeView<SessionTreeNode>;
  private readonly relativeTimeScheduler = new VisibleRefreshScheduler(() =>
    this.treeProvider.refresh(),
  );
  private scanAvailable = true;
  private scanGeneration = 0;
  private usageAnalysisGeneration = 0;
  private inspectorAnalysis: vscode.CancellationTokenSource | undefined;
  private enablingAll = false;
  private disposed = false;
  private lastStatusKey: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private watchedDirectory: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private titleWatcher: vscode.FileSystemWatcher | undefined;
  private watchedTitleDirectory: string | undefined;
  private titleRefreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.aliasStore = new SessionAliasStore(
      context.globalState,
      context.storageUri ? [context.workspaceState] : [],
    );
    this.treeView = vscode.window.createTreeView(VIEW_ID, {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
    });
    this.statusBar.name = vscode.l10n.t("Recent Copilot Chat ID");
    this.statusBar.command = COMMANDS.openView;
  }

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.refresh, async () => {
        await this.refresh(true);
      }),
      vscode.commands.registerCommand(COMMANDS.copyRecent, async () => {
        await this.copyRecent();
      }),
      vscode.commands.registerCommand(COMMANDS.showSessions, async () => {
        await this.showSessions();
      }),
      vscode.commands.registerCommand(COMMANDS.showOutput, () => {
        this.output.show(true);
      }),
      vscode.commands.registerCommand(
        COMMANDS.openView,
        async (node?: SessionTreeNode) => this.openView(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.copySession,
        async (node?: SessionTreeNode) => this.copyTreeSession(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.copySessionId,
        async (node?: SessionTreeNode) => this.copyTreeSessionId(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.openInspector,
        async (node?: SessionTreeNode) => this.openInspector(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.analyzeUsage,
        async (node?: SessionTreeNode) => this.analyzeUsage(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.showDetails,
        async (node?: SessionTreeNode) => this.openView(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.setAlias,
        async (node?: SessionTreeNode) => this.setAlias(node),
      ),
      vscode.commands.registerCommand(
        COMMANDS.clearAlias,
        async (node?: SessionTreeNode) => this.clearAlias(node),
      ),
      vscode.commands.registerCommand(COMMANDS.openSettings, async () => {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          CONFIG_SECTION,
        );
      }),
      vscode.commands.registerCommand(COMMANDS.enable, async () => {
        await vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .update(ENABLED_SETTING, true, vscode.ConfigurationTarget.Global);
      }),
      vscode.commands.registerCommand(COMMANDS.enableTitles, async () => {
        await this.promptToEnableTitles();
      }),
      vscode.commands.registerCommand(COMMANDS.enableAll, async () => {
        await this.enableAllFeatures();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (this.enablingAll) {
          return;
        }
        if (
          event.affectsConfiguration(`${CONFIG_SECTION}.${ENABLED_SETTING}`) ||
          event.affectsConfiguration(`${CONFIG_SECTION}.${READ_TITLES_SETTING}`)
        ) {
          this.runSafely(() => this.refresh(false));
        }
        if (
          event.affectsConfiguration(
            `${CONFIG_SECTION}.${READ_USAGE_SETTING}`,
          ) &&
          !this.isUsageReadingEnabled()
        ) {
          this.usageAnalysisGeneration++;
          this.cancelInspectorAnalysis();
          this.usageReader.clear();
          this.displayedUsage.clear();
          this.inspector.close();
        }
        if (
          event.affectsConfiguration(
            `${CONFIG_SECTION}.${ANALYZE_ON_OPEN_SETTING}`,
          ) &&
          !this.isInspectorAnalysisEnabled()
        ) {
          this.usageAnalysisGeneration++;
          this.cancelInspectorAnalysis();
          const shownId = this.inspector.shownSessionId;
          if (shownId) {
            this.inspector.update(shownId, this.displayedUsage.get(shownId));
          }
        }
      }),
      this.inspector.onDidClose(() => {
        this.cancelInspectorAnalysis();
      }),
      this.treeView.onDidChangeVisibility((event) => {
        this.relativeTimeScheduler.setVisible(event.visible);
      }),
    );
    this.relativeTimeScheduler.setVisible(this.treeView.visible);
  }

  /** Fire-and-forget entry point that keeps async failures out of unhandled rejections. */
  runSafely(task: () => Promise<void>): void {
    void task().catch((error: unknown) => {
      if (!this.disposed) {
        this.output.error(`Unexpected failure: ${toSafeErrorCode(error)}.`);
      }
    });
  }

  async refresh(notify: boolean): Promise<void> {
    const generation = ++this.scanGeneration;

    if (!this.isEnabled()) {
      this.sessions = [];
      this.scanAvailable = false;
      await this.rebuildRecords();
      this.stopWatching();
      this.statusBar.hide();
      this.lastStatusKey = undefined;
      this.output.info("Filename scanning is disabled.");
      if (notify) {
        await this.promptToEnable();
      }
      return;
    }

    const sessionDirectory = this.resolveSessionDirectory();
    if (!sessionDirectory) {
      this.sessions = [];
      this.scanAvailable = false;
      await this.rebuildRecords();
      this.stopWatching();
      this.renderUnavailable();
      this.output.warn(
        "Local workspace storage is unavailable in this window.",
      );
      if (notify) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t(
            "Recent Copilot Chat ID cannot access local workspace storage in this window.",
          ),
        );
      }
      return;
    }

    this.startWatching(sessionDirectory);

    try {
      const sessions = await this.readSessions(sessionDirectory);
      if (this.isStale(generation)) {
        if (!this.disposed) {
          this.scheduleRefresh();
        }
        return;
      }

      this.sessions = sessions;
      this.scanAvailable = true;
      await this.rebuildRecords();
      this.renderSessions();
      this.logScanResult();
      if (notify) {
        const message = this.sessions.length
          ? vscode.l10n.t(
              "Found {0} saved Copilot Chat session ID(s).",
              String(this.sessions.length),
            )
          : vscode.l10n.t("No saved Copilot Chat session IDs were found.");
        void vscode.window.showInformationMessage(message);
      }
    } catch (error) {
      if (this.isStale(generation)) {
        return;
      }

      this.sessions = [];
      this.scanAvailable = false;
      await this.rebuildRecords();
      this.renderUnavailable();
      this.output.warn(
        `Session filename scan unavailable: ${toSafeErrorCode(error)}.`,
      );
      if (notify) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t(
            "Recent Copilot Chat ID could not read the local session filename list.",
          ),
        );
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.scanGeneration++;
    this.usageAnalysisGeneration++;
    this.cancelInspectorAnalysis();
    this.stopWatching();
    this.stopTitleWatching();
    this.relativeTimeScheduler.dispose();
    this.inspector.dispose();
    this.usageReader.dispose();
    this.treeView.dispose();
    this.treeProvider.dispose();
    this.statusBar.dispose();
    this.output.dispose();
  }

  /** Offers opt-in once per profile so the disabled default stays discoverable without nagging. */
  async showIntroOnce(): Promise<void> {
    if (
      this.isEnabled() ||
      this.context.globalState.get<boolean>(INTRO_SHOWN_KEY, false)
    ) {
      return;
    }

    await this.context.globalState.update(INTRO_SHOWN_KEY, true);
    await this.promptToEnable();
  }

  private isStale(generation: number): boolean {
    return this.disposed || generation !== this.scanGeneration;
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>(ENABLED_SETTING, false);
  }

  private isTitleReadingEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>(READ_TITLES_SETTING, false);
  }
  private isUsageReadingEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>(READ_USAGE_SETTING, false);
  }

  private isInspectorAnalysisEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>(ANALYZE_ON_OPEN_SETTING, false);
  }

  private inspectorUsageSettings(): InspectorUsageSettings {
    return {
      usageReadingEnabled: this.isUsageReadingEnabled(),
      analyzeOnOpenEnabled: this.isInspectorAnalysisEnabled(),
    };
  }

  /** Stops an Inspector-initiated read without clearing the shared usage cache. */
  private cancelInspectorAnalysis(): void {
    const pending = this.inspectorAnalysis;
    this.inspectorAnalysis = undefined;
    pending?.cancel();
  }

  private async rebuildRecords(): Promise<void> {
    let index: ReadonlyMap<string, SessionIndexMetadata> = new Map();
    let titlesUnsupported = false;
    if (this.isEnabled() && this.isTitleReadingEnabled()) {
      const databasePath = resolveSessionIndexPath(
        this.context.storageUri?.fsPath,
        this.context.globalStorageUri.fsPath,
      );
      const result = readSessionIndex(
        databasePath,
        new Set(this.sessions.map((session) => session.id)),
      );
      index = result.entries;
      titlesUnsupported = result.errorCode === "SessionIndexUnsupportedRuntime";
      if (titlesUnsupported) {
        // The runtime cannot change mid-session, so stop watching instead of re-reporting.
        this.stopTitleWatching();
      } else {
        this.startTitleWatching(databasePath);
      }
      if (result.errorCode && result.errorCode !== "IndexNotFound") {
        this.output.warn(
          `Session title metadata unavailable: ${result.errorCode}.`,
        );
      }
    } else {
      this.stopTitleWatching();
    }

    this.records = buildSessionRecords(
      this.sessions,
      index,
      await this.getAliases(),
      vscode.l10n.t,
    );
    this.treeProvider.setRecords(this.records);
    this.treeView.message = this.resolveTreeMessage(titlesUnsupported);
    await Promise.all(
      [
        ["agShowSessionId.hasSessions", this.records.length > 0],
        ["agShowSessionId.scanAvailable", this.scanAvailable],
      ].map(([key, value]) =>
        vscode.commands.executeCommand("setContext", key, value),
      ),
    );
  }

  private resolveTreeMessage(titlesUnsupported: boolean): string | undefined {
    if (!this.isEnabled() || this.records.length === 0) {
      return undefined;
    }
    if (titlesUnsupported) {
      return vscode.l10n.t(
        "Session titles are unavailable in this VS Code runtime. Filename scanning still works, and local titles can be set from the context menu.",
      );
    }
    return this.isTitleReadingEnabled()
      ? undefined
      : vscode.l10n.t(
          "Session titles are off. Use the eye button to enable title metadata, or set local titles from the context menu.",
        );
  }

  private async getAliases(): Promise<Readonly<Record<string, string>>> {
    const ids = this.sessions.map((session) => session.id);
    await this.aliasStore.migrate(ids);
    return this.aliasStore.getAll(ids);
  }

  /** Empty windows keep chat sessions in global storage instead of workspace storage. */
  private resolveSessionDirectory(): vscode.Uri | undefined {
    const storageUri = this.context.storageUri;
    if (storageUri?.scheme === "file") {
      return vscode.Uri.joinPath(storageUri, "..", "chatSessions");
    }

    const globalStorageUri = this.context.globalStorageUri;
    if (globalStorageUri?.scheme === "file") {
      return vscode.Uri.joinPath(
        globalStorageUri,
        "..",
        "emptyWindowChatSessions",
      );
    }

    return undefined;
  }

  private async readSessions(
    sessionDirectory: vscode.Uri,
  ): Promise<SavedSession[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(sessionDirectory);
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      ) {
        return [];
      }
      throw error;
    }

    const files = await Promise.all(
      entries.map(
        async ([name, type]): Promise<StoredSessionFile | undefined> => {
          if ((type & vscode.FileType.File) === 0 || !parseSessionId(name)) {
            return undefined;
          }

          try {
            const stat = await vscode.workspace.fs.stat(
              vscode.Uri.joinPath(sessionDirectory, name),
            );
            return { name, modifiedAt: stat.mtime };
          } catch {
            this.output.warn("A session filename disappeared during scanning.");
            return undefined;
          }
        },
      ),
    );

    return buildSavedSessions(
      files.filter((file): file is StoredSessionFile => file !== undefined),
    );
  }

  private renderSessions(): void {
    this.applyStatus(describeRecordStatus(this.records, vscode.l10n.t));
  }

  private renderUnavailable(): void {
    this.applyStatus(describeUnavailableStatus(vscode.l10n.t));
  }

  private applyStatus(status: RecentChatStatus): void {
    if (this.disposed) {
      return;
    }

    const statusKey = [
      status.kind,
      status.text,
      status.ariaLabel,
      status.tooltip,
    ].join("\u0000");
    if (statusKey === this.lastStatusKey) {
      return;
    }

    this.lastStatusKey = statusKey;
    this.statusBar.text = status.text;
    this.statusBar.tooltip = new vscode.MarkdownString(status.tooltip);
    this.statusBar.accessibilityInformation = { label: status.ariaLabel };
    this.statusBar.command = STATUS_COMMANDS[status.kind];
    this.statusBar.show();
  }

  private async copyRecent(): Promise<void> {
    if (!(await this.ensureEnabled())) {
      return;
    }

    await this.refresh(false);
    if (this.sessions.length === 0) {
      await this.reportNoSessions();
      return;
    }

    if (isMostRecentAmbiguous(this.sessions)) {
      await this.showSessions({
        refresh: false,
        placeHolder: vscode.l10n.t(
          "Multiple sessions share the latest save time. Select the ID to copy.",
        ),
      });
      return;
    }

    const recent = this.sessions[0];
    await this.copySessionId(recent.id);
  }

  private async showSessions(
    options: { refresh?: boolean; placeHolder?: string } = {},
  ): Promise<void> {
    if (!(await this.ensureEnabled())) {
      return;
    }

    if (options.refresh ?? true) {
      await this.refresh(false);
    }

    if (this.sessions.length === 0) {
      await this.reportNoSessions();
      return;
    }

    const selected = await vscode.window.showQuickPick(
      buildSessionQuickPickEntries(
        this.records,
        vscode.env.language,
        vscode.l10n.t,
      ),
      {
        title: vscode.l10n.t("Saved Copilot Chat session IDs"),
        placeHolder:
          options.placeHolder ?? vscode.l10n.t("Select an ID to copy it"),
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );

    if (selected) {
      await this.copySessionId(selected.record.id);
    }
  }

  private async openView(node?: SessionTreeNode): Promise<void> {
    if (!(await this.ensureEnabled())) {
      return;
    }
    await this.refresh(false);
    const requestedId = node?.kind === "session" ? node.record.id : undefined;
    const record = selectSessionRecord(this.records, requestedId);
    if (requestedId && !record) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("That saved session is no longer available."),
      );
      return;
    }
    const sessionNode = record
      ? this.treeProvider.getSessionNode(record.id)
      : undefined;
    if (sessionNode) {
      await this.treeView.reveal(sessionNode, {
        select: true,
        focus: true,
        expand: 1,
      });
    } else {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
  }

  private async copyTreeSession(node?: SessionTreeNode): Promise<void> {
    const record = this.recordFromNode(node);
    if (record) {
      await this.copySessionWithTitle(record);
      return;
    }
    await this.copyRecent();
  }

  private async copyTreeSessionId(node?: SessionTreeNode): Promise<void> {
    if (node?.kind === "detail" && node.key === "id") {
      await this.copySessionId(node.id);
      return;
    }
    const record = this.recordFromNode(node) ?? (await this.selectRecord());
    if (record) {
      await this.copySessionId(record.id);
    }
  }

  private async openInspector(node?: SessionTreeNode): Promise<void> {
    if (!(await this.ensureEnabled())) {
      return;
    }
    const inspectorGeneration = ++this.usageAnalysisGeneration;
    this.cancelInspectorAnalysis();
    await this.refresh(false);
    if (inspectorGeneration !== this.usageAnalysisGeneration) {
      return;
    }
    const requestedId = node?.kind === "session" ? node.record.id : undefined;
    const record = requestedId
      ? selectSessionRecord(this.records, requestedId)
      : await this.selectRecord();
    if (requestedId && !record) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("That saved session is no longer available."),
      );
      return;
    }
    if (!record || inspectorGeneration !== this.usageAnalysisGeneration) {
      return;
    }
    if (!this.isUsageReadingEnabled()) {
      this.usageReader.clear();
      this.displayedUsage.clear();
    }
    const cached = this.displayedUsage.get(record.id);
    const sessionDirectory = this.resolveSessionDirectory();
    const analyzeOnOpen = canAnalyzeOnInspectorOpen(
      this.inspectorUsageSettings(),
      sessionDirectory !== undefined,
    );
    this.inspector.show(record, analyzeOnOpen ? { kind: "analyzing" } : cached);
    if (analyzeOnOpen && sessionDirectory) {
      await this.analyzeUsageOnOpen(
        record,
        sessionDirectory,
        inspectorGeneration,
      );
    }
  }

  /** Reads usage for an already-visible Inspector; only the opt-in setting starts this. */
  private async analyzeUsageOnOpen(
    record: SessionRecord,
    sessionDirectory: vscode.Uri,
    generation: number,
  ): Promise<void> {
    const tokenSource = new vscode.CancellationTokenSource();
    this.inspectorAnalysis = tokenSource;
    let cancelled = false;
    let result: SessionUsageReadResult;
    try {
      result = await this.usageReader.read(
        sessionDirectory,
        record.id,
        tokenSource.token,
      );
    } finally {
      cancelled = tokenSource.token.isCancellationRequested;
      if (this.inspectorAnalysis === tokenSource) {
        this.inspectorAnalysis = undefined;
      }
      tokenSource.dispose();
    }
    if (
      !shouldApplyInspectorUsage(this.inspectorUsageSettings(), {
        cancelled,
        staleGeneration: generation !== this.usageAnalysisGeneration,
        errorCode: result.kind === "error" ? result.errorCode : undefined,
      })
    ) {
      return;
    }
    if (result.kind === "error") {
      this.output.warn(
        `Session usage unavailable for ${shortenSessionId(record.id)}: ${result.errorCode}.`,
      );
    }
    const usage: SessionInspectorUsage =
      result.kind === "ok"
        ? {
            kind: "ok",
            summary: result.summary,
            sourceModifiedAt: result.sourceModifiedAt,
          }
        : { kind: "error", errorCode: result.errorCode };
    this.displayedUsage.set(record.id, usage);
    this.inspector.update(record.id, usage);
  }

  private async analyzeUsage(node?: SessionTreeNode): Promise<void> {
    if (!(await this.ensureEnabled()) || !(await this.promptToEnableUsage())) {
      return;
    }
    const analysisGeneration = ++this.usageAnalysisGeneration;
    this.cancelInspectorAnalysis();
    await this.refresh(false);
    if (
      !this.isUsageReadingEnabled() ||
      analysisGeneration !== this.usageAnalysisGeneration
    ) {
      return;
    }
    const requestedId = node?.kind === "session" ? node.record.id : undefined;
    const record = requestedId
      ? selectSessionRecord(this.records, requestedId)
      : await this.selectRecord();
    if (requestedId && !record) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("That saved session is no longer available."),
      );
      return;
    }
    const sessionDirectory = this.resolveSessionDirectory();
    if (!record || !sessionDirectory) {
      return;
    }

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t(
          "Analyzing AI Credits for {0}",
          stripStatusIcons(record.displayTitle),
        ),
        cancellable: true,
      },
      (_progress, token) => {
        if (
          !this.isUsageReadingEnabled() ||
          analysisGeneration !== this.usageAnalysisGeneration
        ) {
          return Promise.resolve({
            kind: "error" as const,
            errorCode: "SessionUsageCancelled" as const,
          });
        }
        return this.usageReader.read(sessionDirectory, record.id, token);
      },
    );
    if (analysisGeneration !== this.usageAnalysisGeneration) {
      return;
    }
    if (!this.isUsageReadingEnabled()) {
      this.usageReader.clear();
      return;
    }
    if (result.kind === "error") {
      if (result.errorCode === "SessionUsageCancelled") {
        return;
      }
      this.output.warn(
        `Session usage unavailable for ${shortenSessionId(record.id)}: ${result.errorCode}.`,
      );
      const usage: SessionInspectorUsage = {
        kind: "error",
        errorCode: result.errorCode,
      };
      this.displayedUsage.set(record.id, usage);
      this.inspector.show(record, usage);
      const showOutput = vscode.l10n.t("Show Output");
      const action = await vscode.window.showWarningMessage(
        describeSessionUsageError(result.errorCode, vscode.l10n.t),
        showOutput,
      );
      if (action === showOutput) {
        this.output.show(true);
      }
      return;
    }
    const usage: SessionInspectorUsage = {
      kind: "ok",
      summary: result.summary,
      sourceModifiedAt: result.sourceModifiedAt,
    };
    this.displayedUsage.set(record.id, usage);
    this.inspector.show(record, usage);
  }
  private async setAlias(node?: SessionTreeNode): Promise<void> {
    if (!(await this.ensureEnabled())) {
      return;
    }
    const record = this.recordFromNode(node) ?? (await this.selectRecord());
    if (!record) {
      return;
    }

    const value = await vscode.window.showInputBox({
      title: vscode.l10n.t("Set local title"),
      prompt: this.context.storageUri
        ? vscode.l10n.t(
            "Stored in this VS Code profile and shared with the empty-window view. Leave empty to remove the local title.",
          )
        : vscode.l10n.t(
            "Stored in this VS Code profile and shared with workspace windows. Leave empty to remove the local title.",
          ),
      value: record.alias ?? "",
      placeHolder: record.displayTitle,
      validateInput: (input) =>
        input.trim().length > MAX_SESSION_ALIAS_LENGTH
          ? vscode.l10n.t(
              "Local titles must be {0} characters or fewer.",
              String(MAX_SESSION_ALIAS_LENGTH),
            )
          : undefined,
    });
    if (value === undefined) {
      return;
    }

    normalizeSessionAlias(value);
    await this.aliasStore.set(record.id, value);
    await this.rebuildRecords();
    this.renderSessions();
    const updated = this.treeProvider.getSessionNode(record.id);
    if (updated) {
      await this.treeView.reveal(updated, { select: true, focus: true });
    }
  }

  private async clearAlias(node?: SessionTreeNode): Promise<void> {
    const record = this.recordFromNode(node) ?? (await this.selectRecord());
    if (!record?.alias) {
      return;
    }
    await this.aliasStore.clear(record.id);
    await this.rebuildRecords();
    this.renderSessions();
  }

  private async selectRecord(): Promise<SessionRecord | undefined> {
    if (this.records.length === 0) {
      await this.reportNoSessions();
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      buildSessionQuickPickEntries(
        this.records,
        vscode.env.language,
        vscode.l10n.t,
      ),
      {
        title: vscode.l10n.t("Saved Copilot Chat sessions"),
        placeHolder: vscode.l10n.t("Select a session"),
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    return selected?.record;
  }

  private recordFromNode(
    node: SessionTreeNode | undefined,
  ): SessionRecord | undefined {
    return node?.kind === "session"
      ? this.records.find((record) => record.id === node.record.id)
      : undefined;
  }

  private async copySessionId(id: string): Promise<void> {
    await copySessionIdWithRecovery(
      id,
      this.createCopyPort(
        (shortId) =>
          vscode.l10n.t("Copied Copilot Chat session ID {0}.", shortId),
        vscode.l10n.t(
          "Could not copy the Copilot Chat session ID. Open the log for details.",
        ),
      ),
    );
  }

  private async copySessionWithTitle(record: SessionRecord): Promise<void> {
    await copySessionWithTitleWithRecovery(
      record.id,
      record.displayTitle,
      this.createCopyPort(
        (shortId) =>
          vscode.l10n.t(
            "Copied title and Copilot Chat session ID {0}.",
            shortId,
          ),
        vscode.l10n.t(
          "Could not copy the title and Copilot Chat session ID. Open the log for details.",
        ),
      ),
    );
  }

  private createCopyPort(
    formatSuccess: (shortId: string) => string,
    failureMessage: string,
  ): CopySessionPort {
    const openLog = vscode.l10n.t("Open Log");
    return {
      writeText: (value) => vscode.env.clipboard.writeText(value),
      showSuccess: (shortId) => {
        void vscode.window.setStatusBarMessage(formatSuccess(shortId), 3000);
      },
      showFailure: async (error) => {
        this.output.warn(`Clipboard write failed: ${toSafeErrorCode(error)}.`);
        const action = await vscode.window.showErrorMessage(
          failureMessage,
          openLog,
        );
        return action === openLog;
      },
      showLog: () => this.output.show(true),
    };
  }

  private async ensureEnabled(): Promise<boolean> {
    return this.isEnabled() || (await this.promptToEnable());
  }

  private async reportNoSessions(): Promise<void> {
    if (this.scanAvailable) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("No saved Copilot Chat session IDs were found."),
      );
      return;
    }

    const openLog = vscode.l10n.t("Open Log");
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t("Copilot Chat session IDs are unavailable in this window."),
      openLog,
    );
    if (action === openLog) {
      this.output.show(true);
    }
  }

  private async promptToEnable(): Promise<boolean> {
    const enable = vscode.l10n.t("Enable");
    const openSettings = vscode.l10n.t("Open Settings");
    const action = await vscode.window.showInformationMessage(
      vscode.l10n.t(
        "Recent Copilot Chat ID scanning is off. It reads session filenames only, never chat content.",
      ),
      enable,
      openSettings,
    );

    if (action === enable) {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(ENABLED_SETTING, true, vscode.ConfigurationTarget.Global);
      return this.isEnabled();
    }

    if (action === openSettings) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `${CONFIG_SECTION}.${ENABLED_SETTING}`,
      );
    }

    return false;
  }

  /** One explicit consent for every machine-local read this extension can perform. */
  private async enableAllFeatures(): Promise<void> {
    this.enablingAll = true;
    let applied = false;
    try {
      applied = await enableAllLocalFeatures(
        [
          ENABLED_SETTING,
          READ_TITLES_SETTING,
          READ_USAGE_SETTING,
          ANALYZE_ON_OPEN_SETTING,
        ],
        {
          confirm: async () => {
            const enableAll = vscode.l10n.t("Enable all");
            const action = await vscode.window.showInformationMessage(
              vscode.l10n.t(
                "Turn on every local feature of Recent Copilot Chat ID?",
              ),
              {
                modal: true,
                detail: vscode.l10n.t(
                  "Filename scanning reads session filenames and modification times. Session titles read one entry from VS Code's local chat index. AI Credits analysis reads the selected session file, which contains chat content, and keeps only the usage summary in memory. Inspector analysis starts that analysis when the Session Inspector opens. No data is sent over the network, and every setting stays machine-local.",
                ),
              },
              enableAll,
            );
            return action === enableAll;
          },
          enable: async (setting) => {
            await vscode.workspace
              .getConfiguration(CONFIG_SECTION)
              .update(setting, true, vscode.ConfigurationTarget.Global);
          },
        },
      );
    } finally {
      this.enablingAll = false;
    }
    if (!applied) {
      return;
    }
    await this.context.globalState.update(INTRO_SHOWN_KEY, true);
    await this.refresh(false);
  }

  private async promptToEnableTitles(): Promise<boolean> {
    if (this.isTitleReadingEnabled()) {
      return true;
    }
    const enable = vscode.l10n.t("Enable titles");
    const openSettings = vscode.l10n.t("Open Settings");
    const action = await vscode.window.showInformationMessage(
      vscode.l10n.t(
        "Session titles can be derived from chat content. Read title metadata from VS Code's local index? Chat messages are never read.",
      ),
      enable,
      openSettings,
    );
    if (action === enable) {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(READ_TITLES_SETTING, true, vscode.ConfigurationTarget.Global);
      await this.refresh(false);
      return true;
    }
    if (action === openSettings) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `${CONFIG_SECTION}.${READ_TITLES_SETTING}`,
      );
    }
    return false;
  }

  private async promptToEnableUsage(): Promise<boolean> {
    if (this.isUsageReadingEnabled()) {
      return true;
    }
    const enable = vscode.l10n.t("Enable usage analysis");
    const openSettings = vscode.l10n.t("Open Settings");
    const action = await vscode.window.showInformationMessage(
      vscode.l10n.t(
        "AI Credits analysis reads the selected local session JSON/JSONL file, which contains chat content. It retains only the usage summary in memory and never sends data over the network. Enable this machine-local setting?",
      ),
      enable,
      openSettings,
    );
    if (action === enable) {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(READ_USAGE_SETTING, true, vscode.ConfigurationTarget.Global);
      return this.isUsageReadingEnabled();
    }
    if (action === openSettings) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `${CONFIG_SECTION}.${READ_USAGE_SETTING}`,
      );
    }
    return false;
  }
  private startWatching(sessionDirectory: vscode.Uri): void {
    const directoryKey = sessionDirectory.toString();
    if (this.watcher && this.watchedDirectory === directoryKey) {
      return;
    }

    this.stopWatching();
    this.watchedDirectory = directoryKey;
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(sessionDirectory, "*.{json,jsonl}"),
    );
    this.watcher.onDidCreate((uri) =>
      this.runSafely(() => this.applyChangedFile(uri)),
    );
    this.watcher.onDidChange((uri) =>
      this.runSafely(() => this.applyChangedFile(uri)),
    );
    this.watcher.onDidDelete((uri) => {
      this.invalidateUsage(parseSessionId(uri.path.split("/").pop() ?? ""));
      this.scheduleRefresh();
    });
  }

  /** A newer save or a delete invalidates the summary the Inspector would otherwise reuse. */
  private invalidateUsage(id: string | undefined): void {
    if (!id || !this.displayedUsage.delete(id)) {
      return;
    }
    this.cancelInspectorAnalysis();
    this.usageAnalysisGeneration++;
    if (this.inspector.shownSessionId === id) {
      this.inspector.update(id, undefined);
    }
  }

  /** Session writes are frequent, so a single change updates one entry instead of re-scanning the folder. */
  private async applyChangedFile(uri: vscode.Uri): Promise<void> {
    const generation = ++this.scanGeneration;
    const name = uri.path.split("/").pop() ?? "";
    const changedId = parseSessionId(name);
    if (!this.isEnabled() || !changedId || this.isStale(generation)) {
      return;
    }
    this.invalidateUsage(changedId);

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (this.isStale(generation)) {
        if (!this.disposed) {
          this.scheduleRefresh();
        }
        return;
      }

      this.sessions = upsertSavedSession(this.sessions, {
        name,
        modifiedAt: stat.mtime,
      });
      await this.rebuildRecords();
      this.scanAvailable = true;
      this.renderSessions();
    } catch {
      this.scheduleRefresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.disposed) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (!this.disposed) {
        this.runSafely(() => this.refresh(false));
      }
    }, 200);
  }

  private stopWatching(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
    this.watchedDirectory = undefined;
  }

  private startTitleWatching(databasePath: string): void {
    const directory = vscode.Uri.file(path.dirname(databasePath));
    const directoryKey = directory.toString();
    if (this.titleWatcher && this.watchedTitleDirectory === directoryKey) {
      return;
    }

    this.stopTitleWatching();
    this.watchedTitleDirectory = directoryKey;
    this.titleWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(directory, SESSION_INDEX_DATABASE_GLOB),
    );
    this.titleWatcher.onDidCreate(() => this.scheduleTitleRefresh());
    this.titleWatcher.onDidChange(() => this.scheduleTitleRefresh());
    this.titleWatcher.onDidDelete(() => this.scheduleTitleRefresh());
  }

  private scheduleTitleRefresh(): void {
    if (this.disposed || !this.isTitleReadingEnabled()) {
      return;
    }
    if (this.titleRefreshTimer) {
      clearTimeout(this.titleRefreshTimer);
    }
    this.titleRefreshTimer = setTimeout(() => {
      this.titleRefreshTimer = undefined;
      if (!this.disposed && this.isTitleReadingEnabled()) {
        this.runSafely(async () => {
          await this.rebuildRecords();
          this.renderSessions();
        });
      }
    }, 250);
  }

  private stopTitleWatching(): void {
    if (this.titleRefreshTimer) {
      clearTimeout(this.titleRefreshTimer);
      this.titleRefreshTimer = undefined;
    }
    this.titleWatcher?.dispose();
    this.titleWatcher = undefined;
    this.watchedTitleDirectory = undefined;
  }

  private logScanResult(): void {
    if (this.sessions.length === 0) {
      this.output.info("No saved session UUID filenames were found.");
      return;
    }

    if (isMostRecentAmbiguous(this.sessions)) {
      this.output.warn(
        "Multiple session UUID filenames share the latest timestamp.",
      );
      return;
    }

    this.output.info(
      `Recent saved session UUID prefix: ${shortenSessionId(this.sessions[0].id)}.`,
    );
  }
}

function toSafeErrorCode(error: unknown): string {
  if (error instanceof vscode.FileSystemError) {
    return [
      "FileExists",
      "FileNotFound",
      "FileNotADirectory",
      "FileIsADirectory",
      "NoPermissions",
      "Unavailable",
      "Unknown",
    ].includes(error.code)
      ? error.code
      : "FileSystemError";
  }
  const name = error instanceof Error ? error.name : "UnknownError";
  return [
    "AbortError",
    "Error",
    "RangeError",
    "SyntaxError",
    "TypeError",
    "UnknownError",
  ].includes(name)
    ? name
    : "UnexpectedError";
}
