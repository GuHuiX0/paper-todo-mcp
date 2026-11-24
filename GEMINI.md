# Paper Todo MCP

The `paper-todo` MCP server manages the user's shared personal to-do list across all terminal and AI agent sessions, backed by a local SQLite (WAL) store (`~/.paper-todo-mcp/todos.db`) and a native Windows 11 paper-style desktop app (with a local HTTP UI fallback on `http://127.0.0.1:4789`).

## Usage Guidelines

- Whenever the user asks in natural language to add, update, reprioritize, defer, check off, delete, or review to-do items (including follow-ups from teammates, Teams, or Outlook), use the `paper-todo` MCP tools directly.
- Map conversational intent cleanly into structured fields:
  - `status`:
    - `now` — active focus items the user is working on right now
    - `todo` — standard queued items (default)
    - `waiting` — items where the user is waiting on someone else's reply or action
    - `inbox` — incoming or unconfirmed items to triage later
    - `done` — completed items
  - `priority`: `high` for urgent/important tasks, otherwise `normal`.
  - `person`: teammate or contact name without a leading `@`.
  - `source`: `teams` or `outlook` when explicitly mentioned, otherwise `agent`.
  - `due`: short human-readable due note (e.g., `Today 5pm`, `Fri`, `2026-11-26`).
- Before updating, completing, or deleting an item described in natural language (without an explicit `#id`), call `list_todos` first to find the matching item ID instead of guessing or creating duplicates.
- When the user asks to open or view the Paper Todo interface, call `open_todos` with `openNativeApp: true`. On Windows, this automatically builds (if needed) and launches or focuses the native Windows Paper Todo app without opening a browser tab; on non-Windows hosts, it opens the local Paper UI in the browser.
- Keep confirmations concise: state the item `#id` and the exact change made.
