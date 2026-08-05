# Recent Copilot Chat ID

<p align="center">
	<strong>See and copy the most recently saved Copilot Chat session UUID without reading chat content.</strong>
</p>

<p align="center">
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><img alt="Status: Preview" src="https://badgen.net/badge/Status/Preview/orange"></a>
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><img alt="VS Marketplace version" src="https://badgen.net/vs-marketplace/v/yamapan.ag-show-session-id"></a>
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><img alt="VS Marketplace installs" src="https://badgen.net/vs-marketplace/i/yamapan.ag-show-session-id"></a>
	<a href="#compatibility"><img alt="VS Code 1.125 or newer" src="https://badgen.net/badge/VS%20Code/%3E%3D%201.125/blue"></a>
	<a href="#privacy"><img alt="Privacy: Local Only" src="https://badgen.net/badge/Privacy/Local%20Only/green"></a>
	<a href="README.ja.md"><img alt="Languages: English and Japanese" src="https://badgen.net/badge/Languages/EN%20%7C%20JA/blue"></a>
	<a href="LICENSE"><img alt="License: CC BY-NC-SA 4.0" src="https://badgen.net/badge/License/CC%20BY-NC-SA%204.0/gray"></a>
	<a href="https://github.com/aktsmm/vscode-recent-copilot-chat-id"><img alt="GitHub source" src="https://badgen.net/badge/GitHub/Source/black"></a>
	<a href="https://github.com/aktsmm/vscode-recent-copilot-chat-id"><img alt="GitHub stars" src="https://badgen.net/github/stars/aktsmm/vscode-recent-copilot-chat-id"></a>
</p>

<p align="center">
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><b>Install from Marketplace</b></a> •
	<a href="#features">Features</a> •
	<a href="#commands">Commands</a> •
	<a href="#privacy">Privacy</a> •
	<a href="README.ja.md">日本語</a>
</p>

---

## Important limitation

This extension shows a **recently saved** session ID. It does not claim to identify the current or active chat session. VS Code does not expose that identity through the stable Extension API.

## Features

- Dedicated **Recent Chat Sessions** Activity Bar view
- Session rows show a local title or VS Code title, short ID, and relative save time
- Expand a row to inspect the full ID, saved time, and title source
- Inline and right-click actions to copy IDs or set/clear a local title
- Status bar: `Recent: <title or short UUID>`; selecting it reveals the session in the browser
- Tooltip shows how many session IDs are saved in the window
- Copy the full recent UUID
- Search saved sessions by title, full/short ID, or saved time
- Manually refresh the filename scan
- Refresh automatically when session files change
- Log diagnostics to the `Recent Copilot Chat ID` Output Channel
- Japanese UI when VS Code display language is `ja`

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id), or run:

```text
ext install yamapan.ag-show-session-id
```

For a local build:

1. Run `npm install` in this repository.
2. Run `npm test` to verify the extension locally.
3. Run `npm run package` to create the VSIX.
4. In VS Code, run **Extensions: Install from VSIX...** from the Command Palette.
5. Select the generated `artifacts/vsix/ag-show-session-id-<version>.vsix` and reload VS Code when prompted.

## Enable

Filename scanning is disabled by default. The extension offers to turn it on once per profile on first activation. You can also run any command and choose **Enable** in the prompt, or set `agShowSessionId.enabled` in User Settings.

The extension then reads only `.json` and `.jsonl` **filenames** from the current window's local `chatSessions` storage directory. It reads file modification times for ordering.
The opt-in setting is machine-scoped and is not synchronized to other devices.

Session titles are a separate opt-in. Enable `agShowSessionId.readTitles` from the view toolbar or Settings to read only the `chat.ChatSessionStore.index` entry from VS Code's local read-only state database. Titles can be derived from chat content, remain in memory only, and are never written to logs. Chat messages and JSONL contents are never read.

Display title precedence is: **local title > VS Code metadata title > Session `<short ID>`**. Local titles persist by session ID in the local VS Code profile, follow the session between empty and workspace windows, are not synchronized, and never modify Copilot Chat storage. Early 0.1 development aliases are migrated automatically.

## Commands

| Command                                        | Purpose                                       |
| ---------------------------------------------- | --------------------------------------------- |
| `Recent Copilot Chat ID: Refresh`              | Scan saved session filenames again            |
| `Recent Copilot Chat ID: Copy Recent ID`       | Copy the most recently saved UUID             |
| `Recent Copilot Chat ID: Show Saved IDs`       | List saved UUIDs and copy the selected one    |
| `Recent Copilot Chat ID: Show Output`          | Open the diagnostic Output Channel            |
| `Recent Copilot Chat ID: Open Session Browser` | Reveal the recent session in the Activity Bar |
| `Recent Copilot Chat ID: Show Details`         | Reveal and expand the selected session        |
| `Recent Copilot Chat ID: Set Local Title`      | Add or rename a local-only session title      |

Global commands appear in the Command Palette under the **Recent Copilot Chat ID** category. Session-specific copy, details, and local-title actions appear on session rows in the Activity Bar.

## Status bar states

| State         | Meaning                                             | Select to                        |
| ------------- | --------------------------------------------------- | -------------------------------- |
| `<title>`     | One session was saved most recently                 | Reveal it in the session browser |
| `ambiguous`   | Several sessions share the latest save time         | Open the session browser         |
| `none`        | No saved session filenames were found               | Open the session browser         |
| `unavailable` | Local session storage cannot be read in this window | Open the log                     |

## Privacy

- No telemetry or network access
- No chat JSON/JSONL content reads
- No debug log reads
- No session file writes
- No prompt, response, reference, or code collection
- Diagnostic logs include only shortened ID prefixes, never full session IDs
- Optional title metadata reads one bounded index entry and retains only session ID, title, and last saved time in memory

## Compatibility

- Minimum declared VS Code version: 1.125.0
- Verified development environment: VS Code 1.131.0 on Windows 11
- Desktop local windows only
- Empty windows (no folder open) read the separate global chat session storage
- Virtual workspaces, VS Code for the Web, and some Remote/WSL layouts can report `unavailable`
- This extension depends on an undocumented internal storage location and degrades without modifying data when that layout is unavailable
- VS Code does not expose a stable API to add actions to built-in Copilot Chat session rows, so this extension uses its own Activity Bar view

The source workspace includes the API and storage analysis at `research/20260805-copilot-chat-session-id-extension.md`.

## Development

```powershell
npm install
npm test
npm run package
npm run verify:install
npm run verify:release
```

The VSIX is written to `artifacts/vsix/`. `verify:install` installs that VSIX into an isolated `.vscode-test` profile and confirms the packaged extension ID and version without changing your normal VS Code installation. `verify:release` runs the complete local gate: dependency audit, unit and Extension Host tests, package verification, and isolated installation.
