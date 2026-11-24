# Paper Todo MCP

A minimalist, paper-inspired to-do list built as a **Model Context Protocol (MCP)** server — featuring a **native Windows 11 WPF desktop app** (with zero-dependency auto-compilation via Windows' built-in `csc.exe`) and a live local web UI fallback for non-Windows hosts.

Designed for **Gemini CLI** multi-session terminal workflows (and also compatible with SEP-1865 MCP Apps hosts).

Keep your task list in a single shared local SQLite database (`WAL` mode) and interact with it in two frictionless ways:

1. **AI Agent Sessions (Natural Language)** — Tell Gemini CLI in any terminal session to add, update, prioritize, check off, or query tasks.
2. **Native Windows Paper App (Direct Interaction)** — A crisp, frameless cotton-paper desktop card beside your terminals (`Alt+Shift+T` to toggle anywhere, `Ctrl+P` to pin always-on-top, closes to system tray). Changes made by any Gemini CLI session flash gently onto the paper within ~1.2 seconds, and manual edits save instantly.

> **Zero Native Build Tooling Required:** On Windows 10/11, `PaperTodo.exe` compiles automatically in ~1.5 seconds using the built-in `.NET Framework 4.x csc.exe` (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`) — **no Rust, no Visual Studio, and no .NET SDK required**.

> **External Adapters (Teams / Outlook):** Intentionally stubbed in [`src/adapters/index.ts`](src/adapters/index.ts) as a clean extension point (`InboundAdapter`) while `source`, `sourceUrl`, `person`, and `inbox` triage fields are already modeled end-to-end.

---

## Requirements

- **Node.js `>= 22.5.0`** (uses Node's built-in `node:sqlite`, so there are zero native npm compilation steps or external runtime dependencies).
- **Windows 10 / 11** for the native WPF desktop app (non-Windows hosts automatically fall back to the local browser UI).

---

## Quick Start for Gemini CLI

### Option 1: Install as a Gemini CLI Extension (Recommended)

Because pre-built self-contained bundles (`dist/server.mjs` and `dist/app.html`), C# WPF source (`desktop/win-native/`), and `gemini-extension.json` are included, you can install directly from GitHub with one command:

```bash
gemini extensions install https://github.com/GuHuiX0/paper-todo-mcp
```

This automatically registers the `paper-todo` MCP server and loads [`GEMINI.md`](GEMINI.md) so Gemini CLI knows how to manage your tasks and launch the native Paper Todo window cleanly.

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

## Native Windows Desktop Features

- **Windows 11 DWM Polish:** Frameless rounded window (`DWMWCP_ROUND`), native soft shadow, 1px archival hairline border, Per-Monitor V2 HiDPI crispness, and ClearType typography.
- **Tactile Cotton Paper Theme:** Warm cream paper (`#FBF8F1`) with subtle fiber grain and terracotta margin rule — plus one-click toggle to dark archival paper (`#1F1D1A`).
- **Always-on-Top Pin (`Ctrl+P`):** Keep the sheet floating next to your terminal tabs while working.
- **Global Hotkey (`Alt+Shift+T`):** Summon or hide Paper Todo from anywhere on Windows.
- **System Tray Resident:** Closing or pressing `Esc` hides cleanly to the system tray; left-click restores, right-click toggles Pin, Light/Dark paper, or Quit.
- **Standalone Launch:** You can also build and launch `dist/PaperTodo.exe` directly anytime (`npm run build:desktop` or double-click `PaperTodo.exe`); it automatically boots a local `--api-only` backend if no Gemini CLI session is active yet.

---

## Daily Workflow

### 1. Talk to any Gemini CLI session

Try natural prompts from any terminal tab:

- *"Open my Paper Todo list"* (builds if needed and launches/focuses the native Windows app, or opens `http://127.0.0.1:4789` on non-Windows)
- *"Add a high-priority focus task: reply to Alex on Teams about the auth timeout by 5pm"*
- *"Mark the staging DB allowlist task as waiting on Maya"*
- *"What am I currently waiting on?"*
- *"Check off the auth timeout task"*

### 2. Interact directly on the Paper Sheet

- **Statuses:** `Focus` (`now`), `Inbox`, `Todo`, `Waiting`, and `Done`
- **Person Filters:** Click any `@person` chip under the header to isolate everything tied to a teammate
- **Quick-Add Micro-Syntax:** Type directly on the top line — optional shortcuts:
  - `@Alex` attaches a person
  - `!` marks urgent (`high` priority)
  - `~` at the start files under `Waiting`
  - `*` at the start files under `Focus`
- **Inline Drawer:** Click any row to edit title, notes, status, person, due note, or priority
- **Keyboard Shortcuts:** `Ctrl+N` focus composer, `Ctrl+P` pin on top, `Esc` cancel edit / hide to tray, `Alt+Shift+T` global show/hide

### Multi-Session Port Sharing

When you open multiple Gemini CLI sessions at once:

- Every session connects to the **same SQLite WAL database** (`~/.paper-todo-mcp/todos.db` by default).
- The first session binds `http://127.0.0.1:4789`; additional sessions detect the active `paper-todo-mcp` instance via `/api/health` and share it without port conflicts.
- If the session holding port `4789` exits, another active session (or the desktop app itself) automatically takes over.

---

## MCP Tools

| Tool | Description |
| :--- | :--- |
| `open_todos` | Returns the current board snapshot and local UI URL; pass `openNativeApp: true` (or `openInBrowser: true`) to launch/focus the native Windows app (or open browser on non-Windows). Also declares SEP-1865 MCP App `ui://paper-todo/app.html` metadata. |
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
| `--port <number>` | `PAPER_TODO_PORT` | `4789` | Localhost port for the local HTTP/API server (`127.0.0.1` only) |
| `--no-web` | `PAPER_TODO_NO_WEB=1` | disabled | Run MCP stdio only without starting the local HTTP/API server |
| `--ui-only` | — | disabled | Start the local backend and launch the native Windows app (or browser on non-Windows) |
| `--api-only` | — | disabled | Run only the local HTTP/API server without MCP stdio or launching UI |
| `--html <path>` | `PAPER_TODO_HTML` | `dist/app.html` | Override the UI HTML bundle path for fast web/MCP-App UI iteration |

---

## Development

```bash
npm install
npm run typecheck
npm run build
npm run build:desktop
npm test
```

- `desktop/win-native/` — Native Windows 11 WPF desktop app (C# 5.0, zero external build deps)
- `src/storage/store.ts` — SQLite WAL persistence & revision counter
- `src/server/index.ts` — MCP stdio server & tool definitions
- `src/server/web.ts` — Localhost HTTP/API server with multi-session port sharing
- `src/server/desktop.ts` — Automatic `csc.exe` builder & single-instance launcher for `PaperTodo.exe`
- `src/ui/` — Minimalist paper HTML, CSS, and dual-transport (`MCP App` + `HTTP`) client
- `src/adapters/index.ts` — Placeholder adapter registry for future Teams / Outlook integrations

---

## License

[MIT](LICENSE)
