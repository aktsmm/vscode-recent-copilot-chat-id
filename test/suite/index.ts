import * as assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
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
  ]) {
    assert.ok(
      commands.includes(command),
      `Command is not registered: ${command}`,
    );
  }

  const configuration = vscode.workspace.getConfiguration("agShowSessionId");
  assert.equal(configuration.get<boolean>("enabled"), false);
  await configuration.update(
    "enabled",
    true,
    vscode.ConfigurationTarget.Global,
  );

  try {
    await vscode.commands.executeCommand("agShowSessionId.refresh");
    await vscode.commands.executeCommand("agShowSessionId.showOutput");

    await Promise.all([
      vscode.commands.executeCommand("agShowSessionId.refresh"),
      vscode.commands.executeCommand("agShowSessionId.refresh"),
      vscode.commands.executeCommand("agShowSessionId.showOutput"),
    ]);
  } finally {
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
      "- four commands registered",
      "- scanning disabled by default",
      "- opt-in refresh completed",
      "- output command completed",
      "- concurrent refreshes completed",
    ].join("\n") + "\n",
  );
}
