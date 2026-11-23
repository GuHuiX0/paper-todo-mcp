# Paper Todo MCP Usage

The `paper-todo` MCP server maintains the user's shared personal to-do list across all AI agent sessions and provides a minimalist paper-style UI in the side pane and sidebar.

## When to use Paper Todo tools

- Whenever the user asks in natural language to record, add, modify, reprioritize, defer, check off, delete, or review to-do items (including follow-ups from Teams, Outlook, or teammates), use the `paper-todo` MCP tools directly.
- Map conversational cues cleanly into structured fields:
  - `status`: use `now` for active focus items, `todo` for normal queued items, `waiting` when waiting on someone else's reply/action, `inbox` for unconfirmed incoming items, and `done` when completed.
  - `priority`: use `high` when urgent/important, otherwise `normal`.
  - `person`: extract the teammate/contact name when someone is mentioned (without a leading `@`).
  - `source`: set to `teams` or `outlook` if the user explicitly mentions the item came from Teams or Outlook; otherwise default to `agent`.
  - `due`: keep concise human-readable deadlines (e.g. `Today 5pm`, `Fri`, `2026-11-26`).
- Before updating, completing, or deleting an item described in natural language (without an explicit ID), call `list_todos` first to find the matching item ID rather than guessing or creating duplicates.
- After modifying the list — or whenever the user asks to view/open their list — call `open_todos` (without `openInBrowser`) so the Paper Todo side pane reflects the latest state immediately. Keep text replies concise (e.g. confirm the exact item `#id` and change made).
