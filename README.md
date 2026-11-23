# Paper Todo MCP

A minimalist, paper-inspired to-do list built as a **Model Context Protocol (MCP)** server — designed for **Gemini CLI** multi-session terminal workflows (and also compatible with SEP-1865 MCP Apps hosts).

Keep your task list in a single shared local SQLite database (`WAL` mode) and interact with it in two frictionless ways:

1. **AI Agent Sessions (Natural Language)** — Tell Gemini CLI in any terminal session to add, update, prioritize, check off, or query tasks.
2. **Minimalist Paper UI (Direct Interaction)** — Keep the tactile, stationery-inspired web UI open beside your terminals (`http://127.0.0.1:4789`). Any change made by any Gemini CLI session live-syncs to the paper sheet within ~2 seconds, and manual clicks/edits save immediately.

> **External Adapters (Teams / Outlook):** Intentionally stubbed in [`src/adapters/index.ts`](src/adapters/index.ts) as a clean extension point (`InboundAdapter`) while `source`, `sourceUrl`, `person`, and `inbox` triage fields are already modeled end-to-end.

---

## Requirements

- **Node.js `>= 22.5.0`** (uses Node's built-in `node:sqlite`, so there are zero native compilation steps or external runtime dependencies).

---

## Quick Start for Gemini CLI

### Option 1: Install as a Gemini CLI Extension (Recommended)

Because pre-built self-contained bundles (`dist/server.mjs` and `dist/app.html`) and `gemini-extension.json` are included, you can install directly from GitHub with one command:

```bash
gemini extensions install https://github.com/GuHuiX0/paper-todo-mcp
```

This automatically registers the `paper-todo` MCP server and loads [`GEMINI.md`](GEMINI.md) so Gemini CLI knows how to manage your tasks cleanly.

### Option 2: Configure in `~/.gemini/settings.json`

Clone the repository and point Gemini CLI to `dist/server.mjs`:

```bash
git clone https://github.com/GuHuiX0/paper-todo-mcp.git
```

Add to `~/.gemini/settings.json` (on Windows: `%USERPROFILE%\.gemini\settings.json`):

```json
{
  "mcpServers": {
    "paper-todo": {
      "command": "node",
      "args": [
        "--no-warnings",
        "/absolute/path/to/paper-todo-mcp/dist/server.mjs"
      ]
    }
  }
}
```

Restart Gemini CLI and verify the connection with `/mcp`.

---

## Daily Workflow

### 1. Talk to any Gemini CLI session

Try natural prompts from any terminal tab:

- *"Open my Paper Todo list"* (launches `http://127.0.0.1:4789` in your browser)
- *"Add a high-priority focus task: reply to Alex on Teams about the auth timeout by 5pm"*
- *"Mark the staging DB allowlist task as waiting on Maya"*
- *"What am I currently waiting on?"*
- *"Check off the auth timeout task"*

### 2. Interact directly on the Paper Sheet

Open `http://127.0.0.1:4789` (or start the UI standalone with `node --no-warnings dist/server.mjs --ui-only`):

- **Statuses:** `Focus` (`now`), `Inbox`, `Todo`, `Waiting`, and `Done`
- **Person Filters:** Click any `@person` chip under the header to isolate everything tied to a teammate
- **Quick-Add Micro-Syntax:** Type directly on the top line — optional shortcuts:
  - `@Alex` attaches a person
  - `!` marks urgent (`high` priority)
  - `~` at the start files under `Waiting`
  - `*` at the start files under `Focus`
- **Inline Drawer:** Click any row to edit title, notes, status, person, due note, or priority
- **Light & Dark Paper:** Follows system/host theme automatically, with a one-click toggle in the top-right corner

### Multi-Session Port Sharing

When you open multiple Gemini CLI sessions at once:

- Every session connects to the **same SQLite WAL database** (`~/.paper-todo-mcp/todos.db` by default).
- The first session binds `http://127.0.0.1:4789`; additional sessions detect the active `paper-todo-mcp` instance via `/api/health` and share it without port conflicts.
- If the session holding port `4789` exits, another active session automatically takes over on its next tool call.

---

## MCP Tools

| Tool | Description |
| :--- | :--- |
| `open_todos` | Returns the current board snapshot and local UI URL; pass `openInBrowser: true` to launch the paper UI in the browser. Also declares SEP-1865 MCP App `ui://paper-todo/app.html` metadata. |
| `list_todos` | Filter or search tasks by `status`, `person`, `source`, or `query`. |
| `add_todo` | Create a task (`title`, `notes`, `status`, `priority`, `person`, `source`, `sourceUrl`, `due`). |
| `update_todo` | Update any field on a task by numeric `id`. |
| `complete_todo` | Mark a task `done` (or pass `done: false` to reopen). |
| `delete_todo` | Permanently delete a task by numeric `id`. |

Internal `app_*` tools (`visibility: ["app"]`) are also exposed for embedded MCP Apps hosts.

---

## CLI Flags & Environment Variables

| Flag | Env Var | Default | Description |
| :--- | :--- | :--- | :--- |
| `--data-dir <path>` | `PAPER_TODO_DATA_DIR` | `~/.paper-todo-mcp` | Directory containing `todos.db` |
| `--port <number>` | `PAPER_TODO_PORT` | `4789` | Localhost port for the Paper Web UI (`127.0.0.1` only) |
| `--no-web` | `PAPER_TODO_NO_WEB=1` | disabled | Run MCP stdio only without starting the local HTTP UI |
| `--ui-only` | — | disabled | Launch only the local Paper Web UI and open it in the browser |
| `--html <path>` | `PAPER_TODO_HTML` | `dist/app.html` | Override the UI HTML bundle path for fast UI iteration |

---

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

- `src/storage/store.ts` — SQLite WAL persistence & revision counter
- `src/server/index.ts` — MCP stdio server & tool definitions
- `src/server/web.ts` — Localhost HTTP UI server with multi-session port sharing
- `src/ui/` — Minimalist paper HTML, CSS, and dual-transport (`MCP App` + `HTTP`) client
- `src/adapters/index.ts` — Placeholder adapter registry for future Teams / Outlook integrations

---

## License

[MIT](LICENSE)
