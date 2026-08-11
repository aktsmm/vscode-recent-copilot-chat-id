import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { SessionRecord } from "./session-model";
import {
  buildSessionInspectorModel,
  SessionInspectorUsage,
} from "./session-inspector-model";
import { renderSessionInspectorHtml } from "./session-inspector-html";

export class SessionInspector implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private shownRecord: SessionRecord | undefined;
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidClose = this.closeEmitter.event;

  get shownSessionId(): string | undefined {
    return this.panel ? this.shownRecord?.id : undefined;
  }

  /** Re-renders only when the panel still shows the same session. */
  update(sessionId: string, usage?: SessionInspectorUsage): void {
    if (this.panel && this.shownRecord?.id === sessionId) {
      this.show(this.shownRecord, usage);
    }
  }

  show(record: SessionRecord, usage?: SessionInspectorUsage): void {
    const model = buildSessionInspectorModel(
      record,
      vscode.env.language,
      vscode.l10n.t,
      usage,
    );
    this.shownRecord = record;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "agShowSessionId.sessionInspector",
        vscode.l10n.t("Session Inspector"),
        vscode.ViewColumn.Active,
        // The default grants the workspace and extension directories; this view needs neither.
        { enableScripts: false, localResourceRoots: [] },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.shownRecord = undefined;
        this.closeEmitter.fire();
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Active, false);
    }
    this.panel.title = vscode.l10n.t(
      "Session Inspector: {0}",
      record.displayTitle,
    );
    this.panel.webview.html = renderSessionInspectorHtml(
      model,
      randomBytes(16).toString("base64url"),
    );
  }

  close(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.shownRecord = undefined;
  }

  dispose(): void {
    this.close();
    this.closeEmitter.dispose();
  }
}
