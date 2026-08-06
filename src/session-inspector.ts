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

  show(record: SessionRecord, usage?: SessionInspectorUsage): void {
    const model = buildSessionInspectorModel(
      record,
      vscode.env.language,
      vscode.l10n.t,
      usage,
    );
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "agShowSessionId.sessionInspector",
        vscode.l10n.t("Session Inspector"),
        vscode.ViewColumn.Active,
        { enableScripts: false },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
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

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
