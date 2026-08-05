# Change Log

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
