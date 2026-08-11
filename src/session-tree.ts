import * as vscode from "vscode";
import { SessionRecord } from "./session-model";
import { buildSessionTreeRows } from "./session-tree-model";

export type SessionTreeNode = SessionNode | DetailNode;

export interface SessionNode {
  readonly kind: "session";
  readonly record: SessionRecord;
}

export interface DetailNode {
  readonly kind: "detail";
  readonly id: string;
  readonly key: "id" | "saved" | "source";
  readonly label: string;
  readonly value: string;
  readonly icon: string;
}

export class SessionTreeProvider
  implements vscode.TreeDataProvider<SessionTreeNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<
    SessionTreeNode | undefined
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private records: readonly SessionRecord[] = [];

  setRecords(records: readonly SessionRecord[]): void {
    this.records = records;
    this.changeEmitter.fire(undefined);
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getSessionNode(id: string): SessionNode | undefined {
    const record = this.records.find((candidate) => candidate.id === id);
    return record ? { kind: "session", record } : undefined;
  }

  getTreeItem(element: SessionTreeNode): vscode.TreeItem {
    if (element.kind === "detail") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = element.value;
      item.tooltip = element.value;
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.contextValue =
        element.key === "id" ? "chatSessionDetailId" : "chatSessionDetail";
      item.id = `chat-session-detail:${element.id}:${element.key}`;
      item.accessibilityInformation = {
        label: `${element.label}: ${element.value}`,
        role: "treeitem",
      };
      return item;
    }

    const [row] = buildSessionTreeRows(
      [element.record],
      vscode.env.language,
      vscode.l10n.t,
    );
    const item = new vscode.TreeItem(
      row.label,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `chat-session:${row.id}`;
    item.description = row.description;
    item.tooltip = new vscode.MarkdownString(row.tooltip);
    item.iconPath = new vscode.ThemeIcon(
      row.icon,
      row.iconColor ? new vscode.ThemeColor(row.iconColor) : undefined,
    );
    item.contextValue = row.hasAlias ? "chatSessionWithAlias" : "chatSession";
    item.accessibilityInformation = {
      label: row.stateLabel
        ? vscode.l10n.t(
            "Chat session {0}, {1}, {2}",
            row.label,
            row.description,
            row.stateLabel,
          )
        : vscode.l10n.t("Chat session {0}, {1}", row.label, row.description),
      role: "treeitem",
    };
    item.command = {
      command: "agShowSessionId.showDetails",
      title: vscode.l10n.t("Show Details"),
      arguments: [element],
    };
    return item;
  }

  getChildren(element?: SessionTreeNode): SessionTreeNode[] {
    if (!element) {
      return this.records.map((record) => ({ kind: "session", record }));
    }
    if (element.kind === "detail") {
      return [];
    }

    const [row] = buildSessionTreeRows(
      [element.record],
      vscode.env.language,
      vscode.l10n.t,
    );
    return [
      {
        kind: "detail",
        id: element.record.id,
        key: "id",
        label: vscode.l10n.t("Session ID"),
        value: element.record.id,
        icon: "key",
      },
      {
        kind: "detail",
        id: element.record.id,
        key: "saved",
        label: vscode.l10n.t("Last saved"),
        value: row.savedLabel,
        icon: "history",
      },
      {
        kind: "detail",
        id: element.record.id,
        key: "source",
        label: vscode.l10n.t("Title source"),
        value: row.sourceLabel,
        icon: "info",
      },
    ];
  }

  getParent(element: SessionTreeNode): SessionTreeNode | undefined {
    return element.kind === "detail"
      ? this.getSessionNode(element.id)
      : undefined;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
