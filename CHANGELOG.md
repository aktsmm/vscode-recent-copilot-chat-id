# Change Log

## 0.3.0 - 2026-08-12

### Added

- Add an Enable All Local Features action to the Command Palette, view toolbar, and welcome view that turns on every machine-local opt-in after one modal disclosure of what each setting reads.
- Add the machine-scoped, default-off `agShowSessionId.analyzeUsageOnInspectorOpen` opt-in that starts usage analysis as the Inspector opens, showing an analyzing state until the read finishes.
- Show the saved response state on Activity Bar session rows with a distinct icon, a tooltip line, and a screen-reader label, instead of the same icon for every session.

### Changed

- Group Session Inspector fields into Session, Timing, Edits, and Usage sections so a single flat list no longer has to be scanned end to end.
- Collapse the three edit-statistic rows into one row when VS Code recorded no statistics, and explain the empty state with a dedicated value instead of the generic unavailable label.
- Point the not-analyzed state at the Analyze AI Credits action so the usage rows are reachable from the Inspector.
- Give every Command Palette session picker the same short ID, response state, relative age, most-recent marker, and full-ID detail that Show Saved IDs already had, and let all of them match on that detail.
- Localize the fallback session title so a window without title metadata no longer shows an English label in the tree, pickers, Inspector, status bar, and clipboard.

### Fixed

- Stop reusing a cached usage summary after the session file changes or is deleted, refresh an open Inspector showing it, and stop re-reading a session file when the Inspector reopens an already analyzed session unless the new opt-in is enabled.
- Cancel an Inspector-initiated usage read when the panel closes, another session is opened, or either usage setting is turned off, without clearing the shared usage cache.
- Load the `node:sqlite` builtin lazily behind a guard so a runtime without it degrades to filename scanning instead of failing activation for every feature.
- Reuse one date formatter per locale and resolve local titles from a single snapshot per batch, so rebuilding a large session list no longer rebuilds formatters and alias maps per row.

### Security

- Escape chat-derived session titles before they reach Markdown tooltips, and strip icon syntax before they reach the status bar, Quick Pick, and progress notifications, so a title can no longer render a link, an image request, or an icon.
- Deny the Session Inspector webview every local resource root instead of inheriting the default workspace and extension access it never used.
- Replace the regular-expression privacy gates with a TypeScript AST scan that walks every source file recursively and rejects indirect module loads, bracketed file-read access, network calls, non-literal message keys, and localized diagnostic logs.

### Documentation

- Document every setting in a table, list the two Command Palette entries that were missing, drop the session-row-only entry that never appeared there, and add a test that keeps both readmes in step with the manifest.

## 0.2.2 - 2026-08-09

- Read request-level `copilotCredits`, `promptTokens`, and `completionTokens` used by normal Chat sessions instead of requiring Agent Host-only totals.
- Match VS Code's session-cost calculation and display model-unattributed input/output token totals.
- Raise the bounded usage input limit from 16 MiB to 64 MiB for long sessions.
- Distinguish not-analyzed, reported, unreported, and failed usage states, and preserve analyzed results when reopening the same saved session.
- Prefer current JSONL sessions over legacy JSON snapshots, replay lines without allocating a full line array, and revalidate cached display data and file type before reuse.
- Verify the packaged usage-analysis opt-in remains machine-scoped and disabled by default.
- Replace raw usage-analysis error codes with localized, recovery-oriented reasons and an action that opens the diagnostic Output Channel.
- Move bounded usage parsing to a cancellable local worker thread with transferable bytes and validated request/result messages.

## 0.2.1 - 2026-08-06

- Keep version-guard tests deterministic before and after a release tag is created.

## 0.2.0 - 2026-08-06

- Change the default session-row copy format from UUID-only to two lines containing the display title and full session ID; UUID-only copy actions remain available.
- Add a script-free Session Inspector for bounded timing, response-state, and changed-line metadata from VS Code's local chat index.
- Keep chat JSON/JSONL content unread by default and validate every retained optional metadata field.
- Add machine-local, default-off AI Credits analysis for one explicitly selected session.
- Retain only backend-reported AI Credits, request count, and model token totals in memory; never estimate credits or retain transcript content.

## 0.1.0 - 2026-08-05

- Add a dedicated Recent Chat Sessions Activity Bar browser.
- Show session titles, short IDs, relative save times, and expandable details.
- Add inline and context actions for copying IDs and managing local titles.
- Add an explicit, machine-local opt-in for title metadata.
- Read only the bounded `chat.ChatSessionStore.index` entry from VS Code's local database; chat messages and JSONL content remain unread.
- Preserve local titles by session ID across empty and workspace windows, including migration from early 0.1 development builds.
- Update status-bar selection to reveal the session instead of copying blindly.
- Add live title refresh, visible-only relative-time refresh, accessibility labels, and Japanese localization.

## 0.0.1 - 2026-08-05

- Initial preview release with filename-only recent session ID discovery, status-bar display, copy commands, Japanese localization, and local-only privacy controls.
