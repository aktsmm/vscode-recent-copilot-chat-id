import { SessionInspectorModel } from "./session-inspector-model";

export function renderSessionInspectorHtml(
  model: SessionInspectorModel,
  nonce: string,
): string {
  const fields = model.fields
    .map(
      ({ label, value }) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="${escapeHtml(model.locale)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeHtml(nonce)}'; base-uri 'none'; form-action 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${escapeHtml(nonce)}">
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 24px; max-width: 760px; }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 24px; }
    dl { display: grid; grid-template-columns: minmax(150px, 0.7fr) minmax(0, 1.3fr); margin: 0; border-top: 1px solid var(--vscode-panel-border); }
    dt, dd { padding: 12px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    dt { color: var(--vscode-descriptionForeground); padding-right: 16px; }
    dd { margin: 0; overflow-wrap: anywhere; user-select: text; white-space: pre-line; }
    .note { color: var(--vscode-descriptionForeground); margin-top: 20px; line-height: 1.5; white-space: pre-line; }
    @media (max-width: 520px) { dl { grid-template-columns: 1fr; } dt { border-bottom: 0; padding-bottom: 4px; } dd { padding-top: 0; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(model.title)}</h1>
    <dl>${fields}</dl>
    <p class="note">${escapeHtml(model.note)}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}