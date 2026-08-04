import * as vscode from "vscode";
import { copySessionIdWithRecovery } from "./copy-session";
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
  describeSessionStatus,
  describeUnavailableStatus,
  RecentChatStatus,
  RecentChatStatusKind,
} from "./status-presentation";

const CONFIG_SECTION = "agShowSessionId";
const ENABLED_SETTING = "enabled";
const INTRO_SHOWN_KEY = "agShowSessionId.introShown";
const COMMANDS = {
  refresh: "agShowSessionId.refresh",
  copyRecent: "agShowSessionId.copyRecent",
  showSessions: "agShowSessionId.showSessions",
  showOutput: "agShowSessionId.showOutput",
} as const;
const STATUS_COMMANDS: Record<RecentChatStatusKind, string> = {
  recent: COMMANDS.copyRecent,
  ambiguous: COMMANDS.showSessions,
  empty: COMMANDS.showSessions,
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
  private scanAvailable = true;
  private scanGeneration = 0;
  private disposed = false;
  private lastStatusKey: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private watchedDirectory: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.statusBar.name = vscode.l10n.t("Recent Copilot Chat ID");
    this.statusBar.command = COMMANDS.copyRecent;
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
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${CONFIG_SECTION}.${ENABLED_SETTING}`)
        ) {
          this.runSafely(() => this.refresh(false));
        }
      }),
    );
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
        return;
      }

      this.sessions = sessions;
      this.scanAvailable = true;
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
    this.stopWatching();
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
    this.applyStatus(describeSessionStatus(this.sessions, vscode.l10n.t));
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

    const latestSavedAt = this.sessions[0].modifiedAt;
    const ambiguous = isMostRecentAmbiguous(this.sessions);
    const selected = await vscode.window.showQuickPick(
      this.sessions.map((session) => ({
        label: session.id,
        description:
          session.modifiedAt === latestSavedAt
            ? ambiguous
              ? vscode.l10n.t("tied for most recent")
              : vscode.l10n.t("most recently saved")
            : undefined,
        detail: vscode.l10n.t(
          "Last saved {0}",
          new Intl.DateTimeFormat(vscode.env.language, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(session.modifiedAt),
        ),
        session,
      })),
      {
        title: vscode.l10n.t("Saved Copilot Chat session IDs"),
        placeHolder:
          options.placeHolder ?? vscode.l10n.t("Select an ID to copy it"),
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );

    if (selected) {
      await this.copySessionId(selected.session.id);
    }
  }

  private async copySessionId(id: string): Promise<void> {
    const openLog = vscode.l10n.t("Open Log");
    await copySessionIdWithRecovery(id, {
      writeText: (value) => vscode.env.clipboard.writeText(value),
      showSuccess: (shortId) => {
        void vscode.window.setStatusBarMessage(
          vscode.l10n.t("Copied Copilot Chat session ID {0}.", shortId),
          3000,
        );
      },
      showFailure: async (error) => {
        this.output.warn(`Clipboard write failed: ${toSafeErrorCode(error)}.`);
        const action = await vscode.window.showErrorMessage(
          vscode.l10n.t(
            "Could not copy the Copilot Chat session ID. Open the log for details.",
          ),
          openLog,
        );
        return action === openLog;
      },
      showLog: () => this.output.show(true),
    });
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
    this.watcher.onDidDelete(() => this.scheduleRefresh());
  }

  /** Session writes are frequent, so a single change updates one entry instead of re-scanning the folder. */
  private async applyChangedFile(uri: vscode.Uri): Promise<void> {
    const generation = this.scanGeneration;
    const name = uri.path.split("/").pop() ?? "";
    if (
      !this.isEnabled() ||
      !parseSessionId(name) ||
      this.isStale(generation)
    ) {
      return;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (this.isStale(generation)) {
        return;
      }

      this.sessions = upsertSavedSession(this.sessions, {
        name,
        modifiedAt: stat.mtime,
      });
      this.scanAvailable = true;
      this.renderSessions();
    } catch {
      this.scheduleRefresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.runSafely(() => this.refresh(false));
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
    return error.code;
  }
  return error instanceof Error ? error.name : "UnknownError";
}
